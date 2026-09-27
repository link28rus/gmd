package pro.periscop.child

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * v0.56.0 — самообновление приложения с собственного сервера, без RuStore
 * (с 2026-09-27 прод семейный, APK ставятся вручную, RuStore на паузе).
 *
 * Цикл [runCycle]:
 *  1. `GET {api}/public/updates/mobile-child/latest?abi=<abi>` — web-endpoint
 *     отдаёт самый свежий APK под ABI и УЖЕ нормализованный versionCode
 *     (ABI offset Flutter `--split-per-abi`, lesson #14).
 *  2. Если versionCode новее установленного — скачать APK в `cacheDir/updates/`
 *     и сверить пакет + versionCode внутри файла.
 *  3. Установить через PackageInstaller session (не ACTION_VIEW, как в v0.40).
 *
 * Тихая установка: на Android 12+ приложение обновляет само себя без диалога,
 * если (а) пользователь один раз разрешил нам «Установку неизвестных
 * приложений» (app-op REQUEST_INSTALL_PACKAGES), (б) в манифесте объявлен
 * UPDATE_PACKAGES_WITHOUT_USER_ACTION, (в) targetSdk не ниже порога для версии
 * Android (API 33 на Android 15). Иначе система отвечает
 * STATUS_PENDING_USER_ACTION → [onInstallStatus] открывает системный диалог
 * (если UI на экране) или показывает уведомление «Нажмите, чтобы установить».
 *
 * PACKAGE_SOURCE_STORE (API 33+) помечает сессию как установку из магазина, а
 * не «из скачанного файла» — Android 13+ не включает для пакета «Ограниченные
 * настройки», которые мешают спецвозможностям у sideload-APK (lesson #28).
 *
 * Кто запускает: [AppUpdateWorker] раз в 6 часов (ставит сам, только когда UI не
 * на экране — иначе обновление закроет приложение под пальцем) и Dart-баннер
 * при открытии (скачивает, ставит по кнопке «Обновить»). Одновременно идёт
 * один цикл — флаг [running].
 */
object AppUpdater {
    const val METHOD_CHANNEL = "pro.periscop.child/updates"
    const val ACTION_INSTALL_STATUS = "pro.periscop.child.APP_UPDATE_STATUS"

    private const val TAG = "updates"
    private const val APP_SLUG = "mobile-child"
    private const val PREFS = "periscop_app_updater"
    private const val KEY_API = "api_base_url"
    private const val KEY_READY_FILE = "ready_filename"
    private const val KEY_READY_VERSION = "ready_version"
    private const val KEY_READY_CODE = "ready_version_code"
    private const val KEY_LAST_CHECK_AT = "last_check_at"
    private const val KEY_LAST_ERROR = "last_error"
    private const val KEY_LAST_ERROR_STAGE = "last_error_stage"
    private const val KEY_NOTIFY_AFTER_UPDATE = "notify_after_update"
    private const val KEY_SESSION_ID = "session_id"
    private const val UPDATES_DIR = "updates"
    private const val NOTIFICATION_CHANNEL = "app_updates"
    private const val NOTIFICATION_ID = 7301
    private const val NOTIFICATION_ID_UPDATED = 7302

    // Имя файла приходит с сервера и идёт в путь на диске и в URL — только
    // безопасные символы, без `/` и `..`.
    private val FILENAME_RE = Regex("^[A-Za-z0-9._+-]+\\.apk$")

    enum class Phase {
        IDLE, CHECKING, UP_TO_DATE, DOWNLOADING, READY, INSTALLING, PENDING_USER_ACTION, FAILED,
    }

    @Volatile private var phase = Phase.IDLE
    @Volatile private var targetVersion: String? = null
    @Volatile private var received = 0L
    @Volatile private var total = 0L

    /** true, пока MainActivity между onResume и onPause. */
    @Volatile var uiVisible = false

    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()

    private data class Latest(
        val version: String,
        val versionCode: Long,
        val filename: String,
        val sizeBytes: Long,
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun log(ctx: Context, msg: String) = DiagLog.write(ctx, TAG, msg)

    /** Запомнить адрес API (для фонового worker'а) и поставить периодическую проверку. */
    fun configure(ctx: Context, apiBaseUrl: String) {
        val app = ctx.applicationContext
        prefs(app).edit().putString(KEY_API, apiBaseUrl.trimEnd('/')).apply()
        AppUpdateWorker.schedule(app)
        clearIfInstalled(app)
    }

    fun canRequestInstall(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 26) ctx.packageManager.canRequestPackageInstalls() else true

    /** Системный экран «Установка неизвестных приложений» сразу на нашем пакете. */
    fun openInstallSettings(activity: Activity) {
        if (Build.VERSION.SDK_INT < 26) return
        activity.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
        )
    }

    /** Проверить и скачать в фоне; установка — по [installNow]. */
    fun checkNow(ctx: Context) {
        val app = ctx.applicationContext
        if (!running.get()) phase = Phase.CHECKING
        executor.execute { runCycle(app, install = false) }
    }

    /** Установить скачанное обновление (кнопка «Обновить» в UI). */
    fun installNow(ctx: Context) {
        val app = ctx.applicationContext
        if (!running.get()) phase = Phase.INSTALLING
        executor.execute {
            val file = readyFile(app)
            if (file == null) {
                runCycle(app, install = true, byUser = true)
                return@execute
            }
            if (!running.compareAndSet(false, true)) return@execute
            try {
                commitSession(app, file, prefs(app).getLong(KEY_READY_CODE, 0L), byUser = true)
            } catch (e: Throwable) {
                fail(app, "install", e)
            } finally {
                running.set(false)
            }
        }
    }

    /**
     * Проверить → скачать → если [install], установить. Блокирующий — вызывать
     * не из main-потока (worker или [executor]).
     */
    fun runCycle(ctx: Context, install: Boolean, byUser: Boolean = false) {
        val app = ctx.applicationContext
        if (!running.compareAndSet(false, true)) {
            log(app, "cycle: уже идёт — пропуск")
            return
        }
        var stage = "check"
        try {
            clearIfInstalled(app)
            val api = prefs(app).getString(KEY_API, null)
            if (api.isNullOrEmpty()) {
                // Адрес API сохраняет Dart при первом открытии UI.
                log(app, "cycle: нет api base (UI ещё не открывали) — пропуск")
                phase = Phase.IDLE
                return
            }
            phase = Phase.CHECKING
            val current = currentVersionCode(app)
            val latest = fetchLatest(app, api, current)
            prefs(app).edit().putLong(KEY_LAST_CHECK_AT, System.currentTimeMillis()).apply()
            if (latest == null || latest.versionCode <= current) {
                log(app, "cycle: актуальная версия (current=$current latest=${latest?.versionCode})")
                phase = Phase.UP_TO_DATE
                clearUpdates(app)
                return
            }
            log(app, "cycle: есть обновление ${latest.version} (${latest.versionCode}) > $current")
            targetVersion = latest.version
            stage = "download"
            val file = download(app, api, latest)
            verifyApk(app, file, latest)
            prefs(app).edit()
                .putString(KEY_READY_FILE, latest.filename)
                .putString(KEY_READY_VERSION, latest.version)
                .putLong(KEY_READY_CODE, latest.versionCode)
                .remove(KEY_LAST_ERROR)
                .remove(KEY_LAST_ERROR_STAGE)
                .apply()
            phase = Phase.READY
            if (install) {
                stage = "install"
                commitSession(app, file, latest.versionCode, byUser)
            }
        } catch (e: Throwable) {
            fail(app, stage, e)
        } finally {
            running.set(false)
        }
    }

    /** Снимок состояния для Dart-баннера. */
    fun status(ctx: Context): Map<String, Any?> {
        val p = prefs(ctx)
        val ready = readyFile(ctx) != null
        var ph = phase
        // Процесс мог перезапуститься после того, как worker скачал APK, а
        // сбой проверки (нет сети) не отменяет уже скачанное обновление.
        val checkFailed = ph == Phase.FAILED && p.getString(KEY_LAST_ERROR_STAGE, null) == "check"
        if ((ph == Phase.IDLE || ph == Phase.UP_TO_DATE || checkFailed) && ready) ph = Phase.READY
        if (ph == Phase.READY && !ready) ph = Phase.IDLE
        return mapOf(
            "phase" to ph.name.lowercase(),
            "version" to (targetVersion ?: if (ready) p.getString(KEY_READY_VERSION, null) else null),
            "received" to received,
            "total" to total,
            "canRequestInstall" to canRequestInstall(ctx),
            "lastCheckAt" to p.getLong(KEY_LAST_CHECK_AT, 0L),
            "lastError" to p.getString(KEY_LAST_ERROR, null),
            "lastErrorStage" to p.getString(KEY_LAST_ERROR_STAGE, null),
        )
    }

    /** Результат PackageInstaller-сессии — из [AppUpdateStatusReceiver]. */
    fun onInstallStatus(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
        log(ctx, "install: session=$sessionId status=$status ${message ?: ""}")
        // Новый цикл бросает прошлую сессию (commitSession), и её ABORTED
        // может прийти уже после коммита новой — не даём ему затереть состояние.
        val current = prefs(ctx).getInt(KEY_SESSION_ID, -1)
        if (status != PackageInstaller.STATUS_SUCCESS && sessionId != -1 && current != -1 && sessionId != current) {
            return
        }
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = confirmIntent(intent)
                if (confirm == null) {
                    fail(ctx, "install", IllegalStateException("нет EXTRA_INTENT для подтверждения"))
                    return
                }
                phase = Phase.PENDING_USER_ACTION
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (uiVisible) {
                    try {
                        ctx.startActivity(confirm)
                        return
                    } catch (e: Throwable) {
                        log(ctx, "install: диалог не открылся (${e.javaClass.simpleName}) — уведомление")
                    }
                }
                val version = prefs(ctx).getString(KEY_READY_VERSION, null)
                notify(
                    ctx,
                    NOTIFICATION_ID,
                    confirm,
                    "Обновление готово к установке",
                    if (version != null) "Версия $version — нажмите, чтобы установить" else "Нажмите, чтобы установить",
                )
            }
            PackageInstaller.STATUS_SUCCESS -> {
                phase = Phase.IDLE
                clearUpdates(ctx)
            }
            // Пользователь закрыл диалог или мы сами бросили старую сессию —
            // APK остаётся, баннер снова предложит «Обновить».
            PackageInstaller.STATUS_FAILURE_ABORTED -> {
                phase = if (readyFile(ctx) != null) Phase.READY else Phase.IDLE
                prefs(ctx).edit().remove(KEY_NOTIFY_AFTER_UPDATE).apply()
            }
            else -> {
                prefs(ctx).edit().remove(KEY_NOTIFY_AFTER_UPDATE).apply()
                fail(ctx, "install", IllegalStateException("status=$status ${message ?: ""}"))
            }
        }
    }

    /**
     * MY_PACKAGE_REPLACED — новая версия встала. Чистим кэш; если ставили по
     * кнопке «Обновить», приложение закрылось под пальцем — зовём обратно
     * уведомлением (старт activity из фона Android запрещает). Фоновые
     * обновления проходят молча.
     */
    fun onPackageReplaced(ctx: Context) {
        val app = ctx.applicationContext
        clearIfInstalled(app)
        val p = prefs(app)
        if (!p.getBoolean(KEY_NOTIFY_AFTER_UPDATE, false)) return
        p.edit().remove(KEY_NOTIFY_AFTER_UPDATE).apply()
        val launch = app.packageManager.getLaunchIntentForPackage(app.packageName) ?: return
        val version = packageInfoOf(app).versionName ?: ""
        notify(app, NOTIFICATION_ID_UPDATED, launch, "Приложение обновлено", "Версия $version — нажмите, чтобы открыть")
    }

    private fun currentVersionCode(ctx: Context): Long =
        versionCodeOf(packageInfoOf(ctx))

    @Suppress("DEPRECATION")
    private fun packageInfoOf(ctx: Context): PackageInfo =
        ctx.packageManager.getPackageInfo(ctx.packageName, 0)

    @Suppress("DEPRECATION")
    private fun versionCodeOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    /**
     * ABI установленного APK — по каталогу нативных библиотек (`…/lib/arm64`),
     * а не по Build.SUPPORTED_ABIS: на x86_64-эмуляторе с ARM-трансляцией в
     * списке есть и arm64-v8a, и выбор «arm64 в приоритете» (как в v0.40)
     * подсунул бы APK с другим ABI offset'ом versionCode.
     */
    private fun installedAbi(ctx: Context): String {
        val dir = ctx.applicationInfo.nativeLibraryDir ?: ""
        return when (File(dir).name) {
            "arm64" -> "arm64-v8a"
            "arm" -> "armeabi-v7a"
            "x86_64" -> "x86_64"
            else -> Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
        }
    }

    private fun fetchLatest(ctx: Context, api: String, current: Long): Latest? {
        val abi = installedAbi(ctx)
        val currentRaw = "${packageInfoOf(ctx).versionName}+$current"
        val url = URL(
            "$api/public/updates/$APP_SLUG/latest?abi=${Uri.encode(abi)}&current=${Uri.encode(currentRaw)}",
        )
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
        }
        try {
            val code = conn.responseCode
            if (code == 204) return null
            if (code != 200) throw IllegalStateException("latest: HTTP $code")
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val filename = json.getString("filename")
            if (!FILENAME_RE.matches(filename)) throw IllegalStateException("latest: недопустимое имя $filename")
            return Latest(
                version = json.getString("version"),
                versionCode = json.optLong("buildNumber", 0L),
                filename = filename,
                sizeBytes = json.optLong("sizeBytes", 0L),
            )
        } finally {
            conn.disconnect()
        }
    }

    private fun download(ctx: Context, api: String, latest: Latest): File {
        val dir = File(ctx.cacheDir, UPDATES_DIR).apply { mkdirs() }
        val target = File(dir, latest.filename)
        val part = File(dir, "${latest.filename}.part")
        // APK прошлых версий больше не нужны.
        dir.listFiles()?.forEach { if (it != target) it.delete() }
        if (target.isFile && (latest.sizeBytes <= 0 || target.length() == latest.sizeBytes)) {
            log(ctx, "download: уже скачан ${target.name}")
            return target
        }
        phase = Phase.DOWNLOADING
        received = 0L
        total = latest.sizeBytes
        // Скачиваем с того же хоста, что и API (не по url из ответа), — ссылка
        // из JSON строится по X-Forwarded-Host и за прокси может оказаться
        // внутренней.
        val url = URL("$api/public/download/${Uri.encode(latest.filename)}")
        log(ctx, "download: $url")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
        }
        try {
            val code = conn.responseCode
            if (code != 200) throw IllegalStateException("download: HTTP $code")
            if (total <= 0L) total = conn.contentLengthLong
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        received += n
                    }
                }
            }
        } catch (e: Throwable) {
            part.delete()
            throw e
        } finally {
            conn.disconnect()
        }
        if (latest.sizeBytes > 0 && part.length() != latest.sizeBytes) {
            val got = part.length()
            part.delete()
            throw IllegalStateException("download: размер $got, ожидали ${latest.sizeBytes}")
        }
        if (!part.renameTo(target)) {
            part.delete()
            throw IllegalStateException("download: не удалось переименовать ${part.name}")
        }
        log(ctx, "download: готово ${target.name} (${target.length()} байт)")
        return target
    }

    /**
     * Внутри файла должен быть наш пакет с тем versionCode, который обещал
     * сервер. Ловит ошибки публикации (lesson #14: effective build в имени
     * вместо pubspec) до того, как система откажет в установке на каждом цикле.
     */
    private fun verifyApk(ctx: Context, file: File, latest: Latest) {
        @Suppress("DEPRECATION")
        val info = ctx.packageManager.getPackageArchiveInfo(file.path, 0)
        val problem = when {
            info == null -> "APK не читается"
            info.packageName != ctx.packageName -> "чужой пакет ${info.packageName}"
            versionCodeOf(info) != latest.versionCode ->
                "versionCode в APK ${versionCodeOf(info)}, сервер обещал ${latest.versionCode}"
            else -> null
        }
        if (problem != null) {
            file.delete()
            throw IllegalStateException("verify: $problem")
        }
    }

    private fun commitSession(ctx: Context, file: File, versionCode: Long, byUser: Boolean) {
        phase = Phase.INSTALLING
        val installer = ctx.packageManager.packageInstaller
        // Неподтверждённые сессии прошлых попыток держат копию APK (~30 МБ).
        for (s in installer.mySessions) {
            try {
                installer.abandonSession(s.sessionId)
            } catch (_: Throwable) {
            }
        }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            setSize(file.length())
            if (Build.VERSION.SDK_INT >= 26) setInstallReason(PackageManager.INSTALL_REASON_USER)
            if (Build.VERSION.SDK_INT >= 31) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            if (Build.VERSION.SDK_INT >= 33) setPackageSource(PackageInstaller.PACKAGE_SOURCE_STORE)
        }
        val sessionId = installer.createSession(params)
        // commit(), не apply(): тихая установка убивает процесс через секунды.
        prefs(ctx).edit()
            .putBoolean(KEY_NOTIFY_AFTER_UPDATE, byUser)
            .putInt(KEY_SESSION_ID, sessionId)
            .commit()
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out, 64 * 1024) }
                    session.fsync(out)
                }
                val intent = Intent(ctx, AppUpdateStatusReceiver::class.java)
                    .setAction(ACTION_INSTALL_STATUS)
                    .putExtra("version_code", versionCode)
                // MUTABLE обязателен: система дописывает EXTRA_STATUS / EXTRA_INTENT.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                val callback = PendingIntent.getBroadcast(ctx, sessionId, intent, flags)
                log(
                    ctx,
                    "install: commit session=$sessionId ${file.name} " +
                        "canRequestInstall=${canRequestInstall(ctx)} sdk=${Build.VERSION.SDK_INT}",
                )
                session.commit(callback.intentSender)
            }
        } catch (e: Throwable) {
            try {
                installer.abandonSession(sessionId)
            } catch (_: Throwable) {
            }
            throw e
        }
    }

    private fun confirmIntent(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= 34) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }

    private fun notify(ctx: Context, id: Int, target: Intent, title: String, text: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(
                    NOTIFICATION_CHANNEL,
                    "Обновления приложения",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ),
            )
        }
        target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        val tap = PendingIntent.getActivity(ctx, id, target, flags)
        val notification = NotificationCompat.Builder(ctx, NOTIFICATION_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        try {
            nm.notify(id, notification)
        } catch (e: SecurityException) {
            log(ctx, "уведомление не показано (нет права): ${e.message}")
        }
    }

    private fun readyFile(ctx: Context): File? {
        val p = prefs(ctx)
        val name = p.getString(KEY_READY_FILE, null) ?: return null
        if (p.getLong(KEY_READY_CODE, 0L) <= currentVersionCode(ctx)) return null
        val file = File(File(ctx.cacheDir, UPDATES_DIR), name)
        return if (file.isFile) file else null
    }

    /** Скачанная версия уже установлена — убрать APK, флаги и уведомление. */
    private fun clearIfInstalled(ctx: Context) {
        val code = prefs(ctx).getLong(KEY_READY_CODE, 0L)
        if (code != 0L && code <= currentVersionCode(ctx)) {
            log(ctx, "обновление до $code установлено — чистим кэш")
            clearUpdates(ctx)
        }
    }

    private fun clearUpdates(ctx: Context) {
        File(ctx.cacheDir, UPDATES_DIR).deleteRecursively()
        prefs(ctx).edit()
            .remove(KEY_READY_FILE)
            .remove(KEY_READY_VERSION)
            .remove(KEY_READY_CODE)
            .apply()
        targetVersion = null
        ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    private fun fail(ctx: Context, stage: String, e: Throwable) {
        phase = Phase.FAILED
        val msg = "${e.javaClass.simpleName}: ${e.message}"
        log(ctx, "$stage failed: $msg")
        prefs(ctx).edit()
            .putString(KEY_LAST_ERROR, msg)
            .putString(KEY_LAST_ERROR_STAGE, stage)
            .apply()
    }

    fun registerChannel(activity: Activity, messenger: BinaryMessenger) {
        MethodChannel(messenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "configure" -> {
                        val api = call.argument<String>("apiBaseUrl")
                        if (api.isNullOrEmpty()) {
                            result.error("bad_args", "apiBaseUrl required", null)
                        } else {
                            configure(activity, api)
                            result.success(null)
                        }
                    }
                    "getStatus" -> result.success(status(activity))
                    "checkNow" -> {
                        checkNow(activity)
                        result.success(status(activity))
                    }
                    "installNow" -> {
                        installNow(activity)
                        result.success(status(activity))
                    }
                    "canRequestInstall" -> result.success(canRequestInstall(activity))
                    "openInstallSettings" -> {
                        openInstallSettings(activity)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Throwable) {
                result.error("updates_failed", "${e.javaClass.simpleName}: ${e.message}", null)
            }
        }
    }
}
