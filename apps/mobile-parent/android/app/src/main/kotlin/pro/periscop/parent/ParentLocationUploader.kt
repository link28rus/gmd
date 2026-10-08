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
 *  - буфер переживает смерть процесса (с v0.73.1 — [ParentLocationBuffer],
 *    см. ниже);
 *  - пачка не чаще раза в [MIN_UPLOAD_GAP_MS]; первая точка после старта
 *    службы уходит сразу;
 *  - сеть / 5xx / 429 → повтор с backoff [BACKOFF_START_MS] → [BACKOFF_MAX_MS];
 *  - 401 → стереть токен, остановить службу (Dart перерегистрирует устройство);
 *  - прочие 4xx (400 валидация, 413) — пачку выкинуть: повтор не поможет.
 *
 * v0.73.0 («Найти телефон»): точки собираются всегда, флаг «Показывать меня
 * семье» влияет только на видимость семье — ветка `sharingDisabled: true`
 * (стоп службы) убрана, сервер больше так не отвечает. В каждый POST идёт
 * `device: {name, pushToken?}` — имя для кабинета и FCM-токен, на который
 * сервер шлёт PLAY_SIGNAL. В ответе `signal.id` (живой сигнал без ack) →
 * [FindPhoneSignal.handle] — запасной путь, если FCM не дошёл.
 *
 * v0.73.1 (защита от кражи): буфер — файл [ParentLocationBuffer] на
 * 20 000 точек вместо 500 в SharedPreferences, переполнение прореживает
 * старые точки, а не выкидывает их. Накопленный хвост уходит пачками по
 * [MAX_BATCH] подряд, с паузой [DRAIN_GAP_MS]. Появилась сеть
 * ([onNetworkAvailable], сигнал от NetworkCallback службы) — backoff
 * сбрасывается и буфер уходит сразу.
 *
 * Все методы — на потоке [handler] (HandlerThread службы).
 */
class ParentLocationUploader(
    private val ctx: Context,
    private val handler: Handler,
    private val onStop: (reason: String) -> Unit,
) {
    companion object {
        /** Лимит пачки на сервере (MAX_PARENT_BATCH_SIZE). */
        const val MAX_BATCH = 500
        const val MIN_UPLOAD_GAP_MS = 60_000L
        /** Пауза между пачками накопленного хвоста: сервер пускает 20 запросов в минуту. */
        const val DRAIN_GAP_MS = 4_000L
        const val BACKOFF_START_MS = 30_000L
        const val BACKOFF_MAX_MS = 5 * 60_000L
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 20_000

        fun bufferedCount(ctx: Context): Int = ParentLocationBuffer.count(ctx)

        fun clearBuffer(ctx: Context) = ParentLocationBuffer.clear(ctx)
    }

    /** elapsedRealtime последней попытки отправки; 0 — ещё не было. */
    private var lastAttemptMs = 0L
    private var backoffMs = 0L
    private var nextAllowedMs = 0L
    private var stopped = false
    /** После успешной пачки в буфере ещё есть точки — следующая через [DRAIN_GAP_MS]. */
    private var draining = false
    private val uploadRunnable = Runnable { uploadNow() }

    private fun log(msg: String) = DiagLog.write(ctx, "ploc", msg)

    /** Добавить точку в буфер и запланировать отправку. */
    fun add(point: JSONObject) {
        if (stopped) return
        ParentLocationBuffer.append(ctx, point.toString())
        schedule()
    }

    /**
     * Сеть снова есть (NetworkCallback службы): забыть backoff и сразу отдать
     * накопленное — телефон мог быть без связи часами.
     */
    fun onNetworkAvailable() {
        if (stopped) return
        backoffMs = 0L
        nextAllowedMs = 0L
        lastAttemptMs = 0L
        val n = bufferedCount(ctx)
        if (n > 0) {
            log("upload: сеть появилась — отправляем $n точек сразу")
            schedule()
        }
    }

    /** Отправить то, что осталось в буфере с прошлого раза (старт службы). */
    fun flushPending() {
        if (bufferedCount(ctx) > 0) schedule()
    }

    fun shutdown() {
        stopped = true
        handler.removeCallbacks(uploadRunnable)
    }

    private fun schedule() {
        if (stopped) return
        val now = SystemClock.elapsedRealtime()
        val gap = if (draining) DRAIN_GAP_MS else MIN_UPLOAD_GAP_MS
        val byGap = if (lastAttemptMs == 0L) 0L else lastAttemptMs + gap
        val due = maxOf(byGap, nextAllowedMs)
        handler.removeCallbacks(uploadRunnable)
        handler.postDelayed(uploadRunnable, (due - now).coerceAtLeast(0L))
    }

    private fun backoff(reason: String) {
        draining = false
        backoffMs = if (backoffMs == 0L) BACKOFF_START_MS else minOf(backoffMs * 2, BACKOFF_MAX_MS)
        nextAllowedMs = SystemClock.elapsedRealtime() + backoffMs
        ParentLocationCreds.recordUpload(ctx, reason)
        log("upload: $reason → повтор через ${backoffMs / 1000} с")
        schedule()
    }

    private fun uploadNow() {
        if (stopped) return
        val creds = ParentLocationCreds.read(ctx)
        if (!creds.usable) {
            log("upload: нет кредов или флаг выключен — пропуск")
            return
        }
        val lines = ParentLocationBuffer.peek(ctx, MAX_BATCH)
        if (lines.isEmpty()) {
            draining = false
            return
        }
        val batch = JSONArray()
        for (l in lines) {
            try {
                batch.put(JSONObject(l))
            } catch (_: Throwable) {
                // битая строка — уйдёт вместе с пачкой из буфера
            }
        }
        val n = lines.size
        lastAttemptMs = SystemClock.elapsedRealtime()

        val code: Int
        val body: String
        try {
            val res = post(creds.baseUrl!!, creds.token!!, requestBody(batch))
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
                ParentLocationBuffer.dropFirst(ctx, n)
                draining = bufferedCount(ctx) > 0
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
                        "rejected=${json?.optInt("rejected", -1)}" +
                        if (draining) " left=${bufferedCount(ctx)}" else "",
                )
                // v0.73.0: живой сигнал «Найти телефон» — запасной путь к FCM.
                json?.optJSONObject("signal")?.optString("id", "")
                    ?.takeIf { it.isNotBlank() }
                    ?.let { FindPhoneSignal.handle(ctx, it, "upload") }
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
                ParentLocationBuffer.dropFirst(ctx, n)
                draining = bufferedCount(ctx) > 0
                schedule()
            }
        }
    }

    /**
     * `{points, device: {name, pushToken?}}`. FCM-токен — из кэша; если его ещё
     * нет — уходит только имя, а токен запрашивается для следующей пачки.
     */
    private fun requestBody(batch: JSONArray): String {
        val device = JSONObject().put("name", FindPhoneSignal.deviceName())
        val pushToken = FindPhoneSignal.cachedFcmToken(ctx)
        if (pushToken != null) {
            device.put("pushToken", pushToken)
        } else {
            FindPhoneSignal.refreshFcmToken(ctx)
        }
        return JSONObject().put("points", batch).put("device", device).toString()
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
