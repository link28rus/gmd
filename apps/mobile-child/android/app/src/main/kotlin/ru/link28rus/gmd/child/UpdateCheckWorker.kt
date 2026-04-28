package ru.link28rus.gmd.child

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * v0.44 — фоновая проверка обновлений mobile-child.
 *
 * Зачем нужен (vs UpdateBanner.checkAndAutoInstall в Dart):
 *  В UpdateBanner проверка триггерится только при build'е home_screen, т.е.
 *  когда ребёнок открывает приложение. На устройствах ребёнка после initial
 *  setup UI обычно не открывают месяцами — только background-FGS трекинг
 *  локации. Без фонового check'а апдейты «зависают» (зафиксировано на телефоне
 *  Степана: process крутился в FGS, версия 0.41.1, 0.43.0 не подтянулась).
 *
 * Этот worker:
 *  1) Раз в 6 часов через WorkManager periodic GET'ит endpoint
 *     `/api/public/updates/mobile-child/latest?abi=...&current=...`.
 *  2) Если backend отдал { version, buildNumber, url, sizeBytes, filename } —
 *     сравнивает effectiveBuild с текущим versionCode (Flutter Gradle plugin
 *     ставит versionCodeOverride = ABI_VERSION[abi]*1000+pubspecBuild,
 *     backend отдаёт ту же формулу — корректно сравнивать как int).
 *  3) Если новее — скачивает APK в `externalCacheDir/updates/<filename>`
 *     (тот же путь, что Dart UpdatesService и file_provider_paths.xml).
 *  4) Показывает high-importance notification «Доступно обновление» —
 *     тап открывает MainActivity → home_screen → UpdateBanner →
 *     UpdateController.checkAndAutoInstall() → видит уже скачанный APK →
 *     запускает системный installer.
 *
 * Безопасность: endpoint публичный (как и /api/public/download), не требует
 * device-token. Поэтому worker работает даже до claim'а (хотя на практике
 * apiBaseUrl задан только после claim'а — без него worker no-op).
 *
 * Constraint: NETWORK CONNECTED. Без сети откладываем.
 */
class UpdateCheckWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    companion object {
        const val UNIQUE_NAME = "gmd_update_check"
        const val TAG = "update_worker"
        private const val NOTIF_CHANNEL_ID = "gmd_update_channel"
        private const val NOTIF_ID = 0xC4
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000
        private const val DOWNLOAD_READ_TIMEOUT_MS = 15 * 60 * 1000 // 15 мин под APK 30МБ на медленном 3G
    }

    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        withContext(Dispatchers.IO) {
            try {
                runCheck()
            } catch (e: Throwable) {
                DiagLog.write(
                    applicationContext,
                    TAG,
                    "doWork unexpected: ${e.javaClass.simpleName}: ${e.message}",
                )
                androidx.work.ListenableWorker.Result.retry()
            }
        }

    private fun runCheck(): androidx.work.ListenableWorker.Result {
        val ctx = applicationContext
        val apiBaseUrl = NativeCreds.getApiBaseUrl(ctx)
        if (apiBaseUrl.isNullOrEmpty()) {
            DiagLog.write(ctx, TAG, "no apiBaseUrl in NativeCreds — skip (pre-claim?)")
            // Не retry — просто ждём следующий periodic.
            return androidx.work.ListenableWorker.Result.success()
        }

        val abi = pickAbi()
        if (abi == null) {
            DiagLog.write(ctx, TAG, "no usable abi from Build.SUPPORTED_ABIS — skip")
            return androidx.work.ListenableWorker.Result.success()
        }

        val pi: PackageInfo = try {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "getPackageInfo failed: ${e.message}")
            return androidx.work.ListenableWorker.Result.success()
        }
        val currentVersionName = pi.versionName ?: "0.0.0"
        @Suppress("DEPRECATION")
        val currentVersionCode =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode.toInt() else pi.versionCode

        val current = "$currentVersionName+$currentVersionCode"
        val url = apiBaseUrl.trimEnd('/') +
            "/public/updates/mobile-child/latest" +
            "?abi=" + URLEncoder.encode(abi, "UTF-8") +
            "&current=" + URLEncoder.encode(current, "UTF-8")

        val (code, body) = httpGet(url) ?: run {
            DiagLog.write(ctx, TAG, "checkLatest network failed → retry")
            return androidx.work.ListenableWorker.Result.retry()
        }
        if (code == 204) {
            DiagLog.write(ctx, TAG, "checkLatest 204 — no APK for abi=$abi")
            return androidx.work.ListenableWorker.Result.success()
        }
        if (code !in 200..299) {
            DiagLog.write(ctx, TAG, "checkLatest HTTP $code — retry later")
            return androidx.work.ListenableWorker.Result.retry()
        }

        val info = parseInfo(body) ?: run {
            DiagLog.write(ctx, TAG, "checkLatest parse failed (body=${body.take(200)}…) — skip")
            return androidx.work.ListenableWorker.Result.success()
        }

        // effectiveBuild на backend == ABI_VERSION[abi]*1000+pubspecBuild,
        // ровно тот же versionCode, что Flutter Gradle ставит в split-per-abi APK.
        if (info.buildNumber <= currentVersionCode) {
            DiagLog.write(
                ctx,
                TAG,
                "up-to-date (current=$currentVersionName+$currentVersionCode, latest=${info.version}+${info.buildNumber})",
            )
            return androidx.work.ListenableWorker.Result.success()
        }

        DiagLog.write(
            ctx,
            TAG,
            "UPDATE: $currentVersionName+$currentVersionCode → ${info.version}+${info.buildNumber}, ${info.sizeBytes}B",
        )

        val updatesDir = File(ctx.externalCacheDir, "updates").apply { mkdirs() }
        val target = File(updatesDir, info.filename)
        if (target.exists() && target.length() == info.sizeBytes.toLong()) {
            DiagLog.write(ctx, TAG, "APK already cached (${target.absolutePath}) — skip download")
        } else {
            if (target.exists()) target.delete()
            val downloaded = downloadTo(info.url, target)
            if (!downloaded) {
                DiagLog.write(ctx, TAG, "download failed — retry")
                return androidx.work.ListenableWorker.Result.retry()
            }
            DiagLog.write(
                ctx,
                TAG,
                "downloaded ${target.absolutePath} (${target.length()}B vs ${info.sizeBytes}B)",
            )
        }

        showUpdateNotification(info)
        return androidx.work.ListenableWorker.Result.success()
    }

    /** Совпадает с приоритетом в UpdatesService.getDeviceAbi (Dart-side). */
    private fun pickAbi(): String? {
        val abis = Build.SUPPORTED_ABIS ?: emptyArray()
        return when {
            abis.contains("arm64-v8a") -> "arm64-v8a"
            abis.contains("armeabi-v7a") -> "armeabi-v7a"
            abis.contains("x86_64") -> "x86_64"
            abis.isNotEmpty() -> abis[0]
            else -> null
        }
    }

    private data class LatestInfo(
        val version: String,
        val buildNumber: Int,
        val filename: String,
        val url: String,
        val sizeBytes: Long,
    )

    private fun parseInfo(json: String): LatestInfo? = try {
        val obj = JSONObject(json)
        LatestInfo(
            version = obj.optString("version"),
            buildNumber = obj.optInt("buildNumber", 0),
            filename = obj.optString("filename"),
            url = obj.optString("url"),
            sizeBytes = obj.optLong("sizeBytes", 0L),
        ).takeIf {
            it.version.isNotEmpty() &&
                it.buildNumber > 0 &&
                it.filename.isNotEmpty() &&
                it.url.isNotEmpty() &&
                it.sizeBytes > 0
        }
    } catch (_: Throwable) {
        null
    }

    private fun httpGet(url: String): Pair<Int, String>? {
        var conn: HttpURLConnection? = null
        return try {
            val u = URL(url)
            conn = (u.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                doInput = true
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "gmd-child-update-worker/1.0")
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
            } ?: ""
            code to body
        } catch (e: Throwable) {
            DiagLog.write(
                applicationContext,
                TAG,
                "GET failed: ${e.javaClass.simpleName}: ${e.message}",
            )
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun downloadTo(url: String, target: File): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            val u = URL(url)
            conn = (u.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = DOWNLOAD_READ_TIMEOUT_MS
                doInput = true
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "gmd-child-update-worker/1.0")
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                DiagLog.write(applicationContext, TAG, "download HTTP $code")
                return false
            }
            conn.inputStream.use { input ->
                FileOutputStream(target).use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        output.write(buf, 0, n)
                    }
                    output.flush()
                }
            }
            true
        } catch (e: Throwable) {
            DiagLog.write(
                applicationContext,
                TAG,
                "download exception: ${e.javaClass.simpleName}: ${e.message}",
            )
            try {
                if (target.exists()) target.delete()
            } catch (_: Throwable) {}
            false
        } finally {
            conn?.disconnect()
        }
    }

    private fun showUpdateNotification(info: LatestInfo) {
        val ctx = applicationContext
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            nm.getNotificationChannel(NOTIF_CHANNEL_ID) == null
        ) {
            val ch = NotificationChannel(
                NOTIF_CHANNEL_ID,
                "Обновления приложения",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Уведомление когда доступно новое обновление gmd_child"
                setShowBadge(true)
            }
            nm.createNotificationChannel(ch)
        }

        // Тап → MainActivity. UpdateController сам подцепит готовый APK.
        // Если REQUEST_INSTALL_PACKAGES granted — installer запустится сразу.
        val openIntent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val openPi = PendingIntent.getActivity(ctx, 1, openIntent, flags)

        // Кроме того, отдельный Intent на «установить сейчас» — он запускает
        // installer напрямую через FileProvider, без открытия Flutter UI.
        // Но: APK URI требует FLAG_GRANT_READ_URI_PERMISSION у получателя,
        // PendingIntent.getActivity это поддерживает. Если REQUEST_INSTALL_PACKAGES
        // не granted — installer покажет «Запретить установку», тогда тап по
        // основной нотификации (openPi → MainActivity) даст корректный flow
        // с openInstallSourceSettings.
        val installIntent = buildInstallIntent(info)
        val installPi = installIntent?.let {
            PendingIntent.getActivity(ctx, 2, it, flags)
        }

        val builder = NotificationCompat.Builder(ctx, NOTIF_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Обновление готово к установке")
            .setContentText("Версия ${info.version} — нажми чтобы установить")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "Доступно обновление приложения «Где мои дети — ребёнок» до версии ${info.version}. " +
                        "Нажми чтобы открыть и установить.",
                ),
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPi)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)

        if (installPi != null) {
            builder.addAction(
                android.R.drawable.stat_sys_download_done,
                "Установить",
                installPi,
            )
        }

        nm.notify(NOTIF_ID, builder.build())
        DiagLog.write(ctx, TAG, "notification shown for ${info.version}")
    }

    private fun buildInstallIntent(info: LatestInfo): Intent? {
        val ctx = applicationContext
        val target = File(File(ctx.externalCacheDir, "updates"), info.filename)
        if (!target.exists()) return null
        val authority = "${ctx.packageName}.fileprovider"
        val uri: Uri = try {
            androidx.core.content.FileProvider.getUriForFile(ctx, authority, target)
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "FileProvider.getUriForFile failed: ${e.message}")
            return null
        }
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
