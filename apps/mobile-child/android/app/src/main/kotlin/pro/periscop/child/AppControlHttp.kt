package pro.periscop.child

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native HTTP-клиент для фоновых вызовов без Dart isolate (FCM-handler,
 * realtime-канал, WorkManager worker'ы). Читает device-token и apiBaseUrl из
 * NativeCreds (SharedPreferences mirror, заполняется UI-isolate'ом при
 * saveNativeCreds).
 *
 * Endpoints:
 *   POST /child/commands/{id}/ack   — подтверждение команды (PLAY_SIGNAL)
 *   POST /child/devices/fcm-token   — регистрация FCM-токена
 *   POST /child/audio/sessions/{id}/error — сбой «Звука вокруг» (v0.62.0, MIC_BLOCKED)
 *
 * Блокировка приложений и экранное время (installed-apps, app-icons,
 * usage-reports, active-block, app-rules, schedules) временно отключены в
 * v0.58.0 — клиентский код удалён, при возврате восстановить из git.
 *
 * Все ошибки логируются через DiagLog.
 */
object AppControlHttp {

  private const val TAG = "app_control_http"
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 60_000

  data class Result(val ok: Boolean, val statusCode: Int, val bodyJson: JSONObject?)

  /**
   * POST /child/commands/{commandId}/ack — без body, идемпотентно
   * (повторный ack команды в статусе executed — no-op).
   *
   * Используется FCM-handler'ом в MyFirebaseMessagingService после старта
   * SignalSoundService: команда должна быть помечена executed, иначе
   * следующий poll-цикл (~90 сек) забёрет её снова и алярм проиграется
   * повторно (v0.44.1 bugfix).
   */
  fun postCommandAck(ctx: Context, commandId: String): Result =
    doPost(ctx, "/child/commands/$commandId/ack", JSONObject())

  /**
   * v0.51.1 fix регрессии latency: POST /child/devices/fcm-token.
   *
   * Дублирует [ChildApi.setFcmToken] на native-стороне чтобы worker'ы и
   * MyFirebaseMessagingService могли обновлять токен без поднятия Dart isolate.
   * Без этого FCM-токен ротировался при обновлении app через RuStore (lesson),
   * но регистрировался только когда ребёнок открывал app в foreground.
   *
   * `token=null` допустимо — backend интерпретирует как «устройство потеряло
   * FCM client» и переключается на poll-only (lesson #14, task #68).
   */
  fun postFcmToken(ctx: Context, token: String?): Result {
    val payload = JSONObject().apply { put("fcmToken", token ?: JSONObject.NULL) }
    return doPost(ctx, "/child/devices/fcm-token", payload)
  }

  /**
   * v0.62.0: POST /child/audio/sessions/{id}/error — отчёт о сбое «Звука вокруг»
   * без Dart-изолята (например MIC_BLOCKED: Android не дал поднять службу
   * микрофона из фона). Backend сразу помечает сессию FAILED.
   */
  fun postAudioSessionError(ctx: Context, sessionId: String, code: String, message: String?): Result {
    val payload = JSONObject().apply {
      put("code", code)
      if (!message.isNullOrEmpty()) put("message", message)
    }
    return doPost(ctx, "/child/audio/sessions/$sessionId/error", payload)
  }

  private fun doPost(ctx: Context, path: String, payload: JSONObject): Result {
    val token = NativeCreds.getToken(ctx)
    val baseUrl = NativeCreds.getApiBaseUrl(ctx)
    if (token.isNullOrEmpty() || baseUrl.isNullOrEmpty()) {
      DiagLog.write(ctx, TAG, "POST $path skipped — no creds (token=${token != null}, base=${baseUrl != null})")
      return Result(ok = false, statusCode = 0, bodyJson = null)
    }

    val urlStr = baseUrl.trimEnd('/') + path
    var conn: HttpURLConnection? = null
    return try {
      val url = URL(urlStr)
      conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        doOutput = true
        doInput = true
        setRequestProperty("Content-Type", "application/json; charset=utf-8")
        setRequestProperty("Accept", "application/json")
        setRequestProperty("X-Child-Token", token)
        setRequestProperty("User-Agent", "periscop-child-worker/0.38")
      }
      conn.outputStream.use { os ->
        os.write(payload.toString().toByteArray(Charsets.UTF_8))
        os.flush()
      }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val body = stream?.let {
        BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { reader -> reader.readText() }
      } ?: ""
      val json = if (body.isNotEmpty() && body.startsWith("{")) {
        try {
          JSONObject(body)
        } catch (_: Throwable) {
          null
        }
      } else {
        null
      }
      val ok = code in 200..299
      if (!ok) {
        val short = if (body.length > 300) body.take(300) + "…" else body
        DiagLog.write(ctx, TAG, "POST $path → $code: $short")
      }
      Result(ok = ok, statusCode = code, bodyJson = json)
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "POST $path FAILED: ${e.javaClass.simpleName}: ${e.message}")
      Result(ok = false, statusCode = -1, bodyJson = null)
    } finally {
      conn?.disconnect()
    }
  }
}
