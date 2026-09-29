package pro.periscop.child

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.GZIPOutputStream

/**
 * v0.60.0 — хранилище настроек журнала (SharedPreferences `periscop_diag`).
 * Разобранный конфиг кешируется в памяти по сырой строке: [DiagLog.debug]
 * зовёт [get] на каждой записи.
 */
object DiagConfigStore {
    private const val PREFS = "periscop_diag"
    private const val KEY_CONFIG = "config_json"

    private class Cached(val raw: String?, val config: DiagConfig)

    @Volatile
    private var cache = Cached(null, DiagConfig.DEFAULT)

    fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun get(ctx: Context): DiagConfig {
        val raw = prefs(ctx).getString(KEY_CONFIG, null)
        val c = cache
        if (raw == c.raw) return c.config
        val parsed = DiagConfig.parse(raw)
        cache = Cached(raw, parsed)
        return parsed
    }

    /** Сохранить конфиг с сервера (JSON-строка DiagConfig). Возвращает разобранный. */
    fun save(ctx: Context, raw: String?): DiagConfig {
        val parsed = DiagConfig.parse(raw)
        val normalized = parsed.toJson()
        prefs(ctx).edit().putString(KEY_CONFIG, normalized).apply()
        cache = Cached(normalized, parsed)
        return parsed
    }
}

/** GET /child/diag/config — один раз за процесс, из LocationForegroundService.onCreate. */
object DiagConfigSync {
    private val fetched = AtomicBoolean(false)

    fun fetchOnce(ctx: Context) {
        if (!fetched.compareAndSet(false, true)) return
        val app = ctx.applicationContext
        Thread {
            try {
                val res = DiagHttp.get(app, "/child/diag/config")
                if (res.code in 200..299 && res.body.trimStart().startsWith("{")) {
                    val cfg = DiagConfigStore.save(app, res.body)
                    DiagLog.write(app, DiagUpload.TAG, "config (GET): ${cfg.summary(System.currentTimeMillis())}")
                } else {
                    // Нет сети / старый сервер без эндпоинта — повторим при следующем старте процесса.
                    fetched.set(false)
                    DiagLog.write(app, DiagUpload.TAG, "config GET → ${res.code} ${res.body.take(200)}")
                }
            } catch (e: Throwable) {
                fetched.set(false)
                DiagLog.write(app, DiagUpload.TAG, "config GET failed: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }
}

/** Постановка отправки журнала в WorkManager. */
object DiagUpload {
    const val TAG = "diag"
    const val REASON_MANUAL = "manual"
    const val REASON_AUTO = "auto"

    const val TRIGGER_PREWARM_FAILED = "audio_prewarm_failed"
    const val TRIGGER_START_FAILED = "audio_start_failed"
    const val TRIGGER_STREAM_FAILED = "audio_stream_failed"
    const val TRIGGER_CRASH = "crash"

    private const val KEY_AUTO_HISTORY = "auto_history"
    private const val WORK_TAG = "diag_upload"
    private val autoLock = Any()

    /** Ручной запрос: команда UPLOAD_DIAG (commandId) или кнопка на /debug (null). */
    fun requestManual(ctx: Context, commandId: String?, source: String): Boolean {
        val name = if (commandId.isNullOrEmpty()) "diag_upload_manual" else "diag_upload_cmd_$commandId"
        DiagLog.write(
            ctx,
            TAG,
            "upload requested via $source commandId=${commandId?.take(8) ?: "-"} → queued",
        )
        return enqueue(ctx, name, REASON_MANUAL, null, commandId)
    }

    /**
     * Автоотправка при сбое. Не чаще раза в 30 мин на trigger и не больше 6 в
     * сутки ([DiagAutoLimiter]); выключается DiagConfig.autoUpload.
     *
     * Ожидаемые сбои лимит не расходуют: до привязки отправлять некуда, а без
     * RECORD_AUDIO служба микрофона не поднимется по понятной причине (идёт
     * мастер разрешений). Иначе такой сбой занял бы слот на 30 мин, и
     * настоящий сбой сразу после выдачи разрешения остался бы без журнала.
     */
    fun autoTrigger(ctx: Context, trigger: String): Boolean {
        val app = ctx.applicationContext
        val safeTrigger = trigger.trim().take(64).ifEmpty { "unknown" }
        return try {
            if (NativeCreds.getToken(app).isNullOrEmpty() || NativeCreds.getApiBaseUrl(app).isNullOrEmpty()) {
                DiagLog.write(app, TAG, "auto trigger=$safeTrigger → skipped (not paired)")
                return false
            }
            if (safeTrigger.startsWith("audio_") &&
                app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            ) {
                DiagLog.write(app, TAG, "auto trigger=$safeTrigger → skipped (no RECORD_AUDIO)")
                return false
            }
            if (!DiagConfigStore.get(app).autoUpload) {
                DiagLog.write(app, TAG, "auto trigger=$safeTrigger → skipped (autoUpload=off)")
                return false
            }
            val decision = synchronized(autoLock) {
                val prefs = DiagConfigStore.prefs(app)
                val history = DiagAutoLimiter.decode(prefs.getString(KEY_AUTO_HISTORY, null))
                val d = DiagAutoLimiter.decide(history, safeTrigger, System.currentTimeMillis())
                prefs.edit().putString(KEY_AUTO_HISTORY, DiagAutoLimiter.encode(d.history)).apply()
                d
            }
            if (!decision.allowed) {
                DiagLog.write(app, TAG, "auto trigger=$safeTrigger → skipped (${decision.reason})")
                return false
            }
            DiagLog.write(app, TAG, "auto trigger=$safeTrigger → queued")
            enqueue(app, "diag_upload_auto_$safeTrigger", REASON_AUTO, safeTrigger, null)
        } catch (e: Throwable) {
            DiagLog.write(app, TAG, "auto trigger=$safeTrigger failed: ${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    private fun enqueue(
        ctx: Context,
        uniqueName: String,
        reason: String,
        trigger: String?,
        commandId: String?,
    ): Boolean = try {
        val req = OneTimeWorkRequestBuilder<DiagUploadWorker>()
            .setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .setInputData(
                workDataOf(
                    DiagUploadWorker.KEY_REASON to reason,
                    DiagUploadWorker.KEY_TRIGGER to trigger,
                    DiagUploadWorker.KEY_COMMAND_ID to commandId,
                    DiagUploadWorker.KEY_REQUESTED_AT to System.currentTimeMillis(),
                ),
            )
            .addTag(WORK_TAG)
            .build()
        // KEEP: повторная доставка той же команды (мгновенный канал + poll)
        // или серия одинаковых сбоев не плодят параллельные отправки.
        WorkManager.getInstance(ctx.applicationContext)
            .enqueueUniqueWork(uniqueName, ExistingWorkPolicy.KEEP, req)
        true
    } catch (e: Throwable) {
        DiagLog.write(ctx, TAG, "enqueue $uniqueName failed: ${e.javaClass.simpleName}: ${e.message}")
        false
    }
}

/** Собирает журнал + снимок + logcat и отправляет POST /child/diag/logs (gzip). */
class DiagUploadWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    companion object {
        const val KEY_REASON = "reason"
        const val KEY_TRIGGER = "trigger"
        const val KEY_COMMAND_ID = "commandId"
        const val KEY_REQUESTED_AT = "requestedAt"

        private const val MAX_ATTEMPTS = 6
        private const val MAX_LOG_BYTES = 2_000_000
        private const val MAX_LOGCAT_BYTES = 2_000_000
        private const val MAX_SNAPSHOT_BYTES = 60_000
        private const val LOGCAT_TIMEOUT_MS = 10_000L
    }

    override fun doWork(): Result {
        val ctx = applicationContext
        val reason = inputData.getString(KEY_REASON) ?: DiagUpload.REASON_MANUAL
        val trigger = inputData.getString(KEY_TRIGGER)
        val commandId = inputData.getString(KEY_COMMAND_ID)
        val requestedAt = inputData.getLong(KEY_REQUESTED_AT, 0L)
        val label = "reason=$reason trigger=${trigger ?: "-"} cmd=${commandId?.take(8) ?: "-"}"

        if (NativeCreds.getToken(ctx).isNullOrEmpty() || NativeCreds.getApiBaseUrl(ctx).isNullOrEmpty()) {
            DiagLog.write(ctx, DiagUpload.TAG, "upload $label → no creds, dropped")
            return Result.failure()
        }

        return try {
            val cfg = DiagConfigStore.get(ctx)
            DiagLog.write(ctx, DiagUpload.TAG, "upload $label attempt=${runAttemptCount + 1}")

            val payload = JSONObject().apply {
                put("reason", reason)
                if (!trigger.isNullOrEmpty()) put("trigger", trigger.take(64))
                if (!commandId.isNullOrEmpty()) put("commandId", commandId)
                put("appVersion", appVersion(ctx).take(32))
                if (cfg.snapshot) {
                    val extra = linkedMapOf(
                        "отправка" to "$reason ${trigger ?: ""}".trim(),
                        "запрошено" to if (requestedAt > 0) fmtTime(requestedAt) else "?",
                        "попытка отправки" to "${runAttemptCount + 1}",
                    )
                    put("snapshot", DiagText.tailUtf8(DiagSnapshot.build(ctx, extra), MAX_SNAPSHOT_BYTES))
                }
                put("log", DiagText.tailUtf8(DiagLog.readForUpload(ctx, cfg.send), MAX_LOG_BYTES))
                if (cfg.logcat) put("logcat", DiagText.tailUtf8(readLogcat(), MAX_LOGCAT_BYTES))
            }
            val body = gzip(payload.toString().toByteArray(Charsets.UTF_8))
            val res = DiagHttp.postGzipJson(ctx, "/child/diag/logs", body)
            when {
                res.code in 200..299 -> {
                    DiagLog.write(ctx, DiagUpload.TAG, "upload $label → ${res.code} (${body.size} B gzip)")
                    Result.success()
                }
                res.code == 401 || res.code == 403 -> {
                    DiagLog.write(ctx, DiagUpload.TAG, "upload $label → ${res.code}, dropped")
                    Result.failure()
                }
                res.code in 400..499 && res.code != 408 && res.code != 429 -> {
                    // 400/404/413 — повтор не поможет (или сервер ещё без эндпоинта).
                    DiagLog.write(ctx, DiagUpload.TAG, "upload $label → ${res.code} ${res.body.take(200)}, dropped")
                    Result.failure()
                }
                else -> retryOrFail(label, "${res.code} ${res.body.take(200)}")
            }
        } catch (e: Throwable) {
            retryOrFail(label, "${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun retryOrFail(label: String, why: String): Result {
        val last = runAttemptCount + 1 >= MAX_ATTEMPTS
        DiagLog.write(
            applicationContext,
            DiagUpload.TAG,
            "upload $label failed: $why → ${if (last) "gave up" else "retry"}",
        )
        return if (last) Result.failure() else Result.retry()
    }

    /**
     * logcat приложения. Без `--pid`: logd и так отдаёт обычному приложению
     * только записи его UID, а записи предыдущего процесса (падение, запуск
     * после обновления/перезагрузки) — самое ценное для автоотправки.
     */
    private fun readLogcat(): String {
        return try {
            val proc = ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", "5000")
                .redirectErrorStream(true)
                .start()
            val out = ByteArrayOutputStream()
            val reader = Thread {
                try {
                    proc.inputStream.use { input ->
                        val buf = ByteArray(16 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            synchronized(out) { out.write(buf, 0, n) }
                        }
                    }
                } catch (_: Throwable) {
                    /* процесс убит по таймауту */
                }
            }
            reader.start()
            if (!proc.waitFor(LOGCAT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) proc.destroy()
            reader.join(2_000)
            val text = synchronized(out) { out.toString(Charsets.UTF_8.name()) }
            "# pid=${Process.myPid()} uid=${Process.myUid()}\n$text"
        } catch (e: Throwable) {
            "logcat failed: ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    private fun gzip(data: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream(data.size / 4 + 64)
        GZIPOutputStream(bos).use { it.write(data) }
        return bos.toByteArray()
    }

    private fun fmtTime(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US).format(Date(ms))

    // `versionName+versionCode` — versionCode устройства (у split-per-abi сборок
    // с ABI-смещением), как на экране /debug.
    @Suppress("DEPRECATION")
    private fun appVersion(ctx: Context): String = try {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode else pi.versionCode.toLong()
        "${pi.versionName}+$code"
    } catch (_: Throwable) {
        "?"
    }
}

/** Минимальный HTTP для журнала (device-token из [NativeCreds]). */
object DiagHttp {
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000

    data class Response(val code: Int, val body: String)

    fun get(ctx: Context, path: String): Response = request(ctx, "GET", path, null)

    fun postGzipJson(ctx: Context, path: String, gzipped: ByteArray): Response =
        request(ctx, "POST", path, gzipped)

    private fun request(ctx: Context, method: String, path: String, gzipped: ByteArray?): Response {
        val token = NativeCreds.getToken(ctx)
        val base = NativeCreds.getApiBaseUrl(ctx)
        if (token.isNullOrEmpty() || base.isNullOrEmpty()) return Response(0, "no creds")
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-Child-Token", token)
                setRequestProperty("User-Agent", "periscop-child-diag")
                if (gzipped != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Content-Encoding", "gzip")
                    setFixedLengthStreamingMode(gzipped.size)
                }
            }
            if (gzipped != null) conn.outputStream.use { it.write(gzipped) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            Response(code, body)
        } finally {
            conn?.disconnect()
        }
    }
}
