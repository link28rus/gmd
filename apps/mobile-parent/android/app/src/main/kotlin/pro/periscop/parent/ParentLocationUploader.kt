package pro.periscop.parent

import android.content.Context
import android.os.Handler
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * v0.70.0 — отправка точек родителя `POST /parent-location/points` нативным
 * HttpURLConnection (без Flutter-изолята).
 *
 * Политика (спека 2026-10-08-family-map-parent-location):
 *  - буфер до [MAX_BUFFER] точек в SharedPreferences (переживает смерть
 *    процесса), лишние — самые старые — выкидываются;
 *  - пачка не чаще раза в [MIN_UPLOAD_GAP_MS]; первая точка после старта
 *    службы уходит сразу;
 *  - сеть / 5xx / 429 → повтор с backoff [BACKOFF_START_MS] → [BACKOFF_MAX_MS];
 *  - 401 → стереть токен, остановить службу (Dart перерегистрирует устройство);
 *  - `sharingDisabled: true` → выключить флаг, остановить службу;
 *  - прочие 4xx (400 валидация, 413) — пачку выкинуть: повтор не поможет.
 *
 * Все методы — на потоке [handler] (HandlerThread службы): буфер без гонок.
 */
class ParentLocationUploader(
    private val ctx: Context,
    private val handler: Handler,
    private val onStop: (reason: String) -> Unit,
) {
    companion object {
        const val MAX_BUFFER = 500
        const val MIN_UPLOAD_GAP_MS = 60_000L
        const val BACKOFF_START_MS = 30_000L
        const val BACKOFF_MAX_MS = 5 * 60_000L
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 20_000
        private const val PREFS = "periscop_parent_location_buffer"
        private const val KEY_POINTS = "points"

        fun bufferedCount(ctx: Context): Int = readBuffer(ctx).length()

        fun clearBuffer(ctx: Context) {
            ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove(KEY_POINTS).commit()
        }

        private fun readBuffer(ctx: Context): JSONArray {
            val raw = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_POINTS, null) ?: return JSONArray()
            return try {
                JSONArray(raw)
            } catch (_: Throwable) {
                JSONArray() // битый буфер — начинаем заново
            }
        }

        private fun writeBuffer(ctx: Context, arr: JSONArray) {
            ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_POINTS, arr.toString()).apply()
        }
    }

    /** elapsedRealtime последней попытки отправки; 0 — ещё не было. */
    private var lastAttemptMs = 0L
    private var backoffMs = 0L
    private var nextAllowedMs = 0L
    private var stopped = false
    private val uploadRunnable = Runnable { uploadNow() }

    private fun log(msg: String) = DiagLog.write(ctx, "ploc", msg)

    /** Добавить точку в буфер и запланировать отправку. */
    fun add(point: JSONObject) {
        if (stopped) return
        val buf = readBuffer(ctx)
        buf.put(point)
        writeBuffer(ctx, trimOldest(buf))
        schedule()
    }

    /** Отправить то, что осталось в буфере с прошлого раза (старт службы). */
    fun flushPending() {
        if (bufferedCount(ctx) > 0) schedule()
    }

    fun shutdown() {
        stopped = true
        handler.removeCallbacks(uploadRunnable)
    }

    private fun trimOldest(buf: JSONArray): JSONArray {
        if (buf.length() <= MAX_BUFFER) return buf
        val out = JSONArray()
        for (i in (buf.length() - MAX_BUFFER) until buf.length()) out.put(buf.get(i))
        return out
    }

    private fun schedule() {
        if (stopped) return
        val now = SystemClock.elapsedRealtime()
        val byGap = if (lastAttemptMs == 0L) 0L else lastAttemptMs + MIN_UPLOAD_GAP_MS
        val due = maxOf(byGap, nextAllowedMs)
        handler.removeCallbacks(uploadRunnable)
        handler.postDelayed(uploadRunnable, (due - now).coerceAtLeast(0L))
    }

    private fun backoff(reason: String) {
        backoffMs = if (backoffMs == 0L) BACKOFF_START_MS else minOf(backoffMs * 2, BACKOFF_MAX_MS)
        nextAllowedMs = SystemClock.elapsedRealtime() + backoffMs
        ParentLocationCreds.recordUpload(ctx, reason)
        log("upload: $reason → повтор через ${backoffMs / 1000} с")
        schedule()
    }

    private fun dropFirst(n: Int) {
        val buf = readBuffer(ctx)
        val out = JSONArray()
        for (i in n until buf.length()) out.put(buf.get(i))
        writeBuffer(ctx, out)
    }

    private fun uploadNow() {
        if (stopped) return
        val creds = ParentLocationCreds.read(ctx)
        if (!creds.usable) {
            log("upload: нет кредов или флаг выключен — пропуск")
            return
        }
        val buf = readBuffer(ctx)
        if (buf.length() == 0) return
        val n = minOf(buf.length(), MAX_BUFFER)
        val batch = JSONArray()
        for (i in 0 until n) batch.put(buf.get(i))
        lastAttemptMs = SystemClock.elapsedRealtime()

        val code: Int
        val body: String
        try {
            val res = post(creds.baseUrl!!, creds.token!!, JSONObject().put("points", batch).toString())
            code = res.first
            body = res.second
        } catch (e: IOException) {
            backoff("сеть: ${e.javaClass.simpleName}: ${e.message}")
            return
        } catch (e: Throwable) {
            backoff("ошибка: ${e.javaClass.simpleName}: ${e.message}")
            return
        }

        when {
            code in 200..299 -> {
                dropFirst(n)
                backoffMs = 0L
                nextAllowedMs = 0L
                ParentLocationCreds.recordUpload(ctx, null)
                val json = try {
                    JSONObject(body)
                } catch (_: Throwable) {
                    null
                }
                log(
                    "upload OK: sent=$n accepted=${json?.optInt("accepted", -1)} " +
                        "rejected=${json?.optInt("rejected", -1)}",
                )
                if (json?.optBoolean("sharingDisabled", false) == true) {
                    log("upload: sharingDisabled — флаг выключен на сервере, стоп")
                    ParentLocationCreds.setEnabled(ctx, false)
                    clearBuffer(ctx)
                    stopped = true
                    onStop("sharingDisabled")
                    return
                }
                schedule() // пока слали, могли прийти новые точки
            }
            code == 401 -> {
                log("upload: 401 — токен отозван/неизвестен, стираем и стоп")
                ParentLocationCreds.markAuthFailed(ctx)
                ParentLocationCreds.recordUpload(ctx, "401")
                clearBuffer(ctx)
                stopped = true
                onStop("401")
            }
            code == 429 || code >= 500 -> backoff("HTTP $code")
            else -> {
                // 400 / 413 / прочие 4xx: эта пачка не пройдёт никогда.
                log("upload: HTTP $code — пачка из $n точек выброшена: ${body.take(200)}")
                ParentLocationCreds.recordUpload(ctx, "HTTP $code")
                dropFirst(n)
                schedule()
            }
        }
    }

    private fun post(baseUrl: String, token: String, json: String): Pair<Int, String> {
        val conn = URL("$baseUrl/parent-location/points").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("X-Parent-Location-Token", token)
            conn.setRequestProperty("X-Client", "mobile-parent")
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Pair(code, body)
        } finally {
            conn.disconnect()
        }
    }
}
