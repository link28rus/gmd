package pro.periscop.child

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * v0.38 Phase 6.1: native HTTP-клиент для WorkManager worker'ов.
 *
 * Используется вместо headless FlutterEngine + Dio — проще, надёжнее, не требует
 * поднимать Dart isolate в фоне. Читает device-token и apiBaseUrl из NativeCreds
 * (SharedPreferences mirror, заполняется UI-isolate'ом при saveNativeCreds).
 *
 * Endpoints (см. apps/backend/src/app-control/):
 *   POST /child/installed-apps  — возвращает {missingIconSha256: string[]}
 *   POST /child/app-icons       — батч ≤50 иконок base64
 *   POST /child/usage-reports   — часовые bucket'ы
 *
 * Все ошибки логируются через DiagLog. Worker'ы решают сами retry/skip
 * (Result.retry() vs Result.success()).
 */
object AppControlHttp {

  private const val TAG = "app_control_http"
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 60_000

  data class Result(val ok: Boolean, val statusCode: Int, val bodyJson: JSONObject?)

  /**
   * POST /child/installed-apps
   *
   * Возвращает Result с bodyJson = {missingIconSha256: [...]}.
   * Если auth fails (401/403) — возвращает ok=false с statusCode, worker логирует и пропускает.
   */
  fun postInstalledApps(
    ctx: Context,
    timezone: String,
    apps: List<AppControlNative.InstalledAppPayload>,
  ): Result {
    val payload = JSONObject().apply {
      put("timezone", timezone)
      val arr = JSONArray()
      for (a in apps) {
        val obj = JSONObject().apply {
          put("packageName", a.packageName)
          put("appLabel", a.appLabel)
          put("isSystem", a.isSystem)
          put("iconSha256", a.iconSha256)
        }
        arr.put(obj)
      }
      put("apps", arr)
    }
    return doPost(ctx, "/child/installed-apps", payload)
  }

  /**
   * POST /child/app-icons (батч ≤50).
   * Возвращает Result с bodyJson = {uploaded:N, skipped:M}.
   */
  fun postAppIcons(
    ctx: Context,
    icons: List<AppControlNative.InstalledAppPayload>,
  ): Result {
    require(icons.size <= 50) { "max 50 icons per batch, got ${icons.size}" }
    val payload = JSONObject().apply {
      val arr = JSONArray()
      for (i in icons) {
        val obj = JSONObject().apply {
          put("sha256", i.iconSha256)
          put("pngBase64", Base64.encodeToString(i.iconPngBytes, Base64.NO_WRAP))
        }
        arr.put(obj)
      }
      put("icons", arr)
    }
    return doPost(ctx, "/child/app-icons", payload)
  }

  /**
   * POST /child/usage-reports.
   * No-op (Result.ok=true) если buckets пустой — backend требует min 1.
   */
  fun postUsageReport(
    ctx: Context,
    timezone: String,
    buckets: List<AppControlNative.UsageBucketPayload>,
  ): Result {
    if (buckets.isEmpty()) return Result(ok = true, statusCode = 204, bodyJson = null)
    val payload = JSONObject().apply {
      put("timezone", timezone)
      val arr = JSONArray()
      for (b in buckets) {
        val obj = JSONObject().apply {
          put("date", b.date)
          put("hour", b.hour)
          put("packageName", b.packageName)
          put("seconds", b.seconds)
        }
        arr.put(obj)
      }
      put("buckets", arr)
    }
    return doPost(ctx, "/child/usage-reports", payload)
  }

  /**
   * GET /child/active-block
   * Возвращает {session: {sessionId, startedAt, endsAt} | null}.
   * Используется PollWorker (60 сек fallback) и при старте app.
   */
  fun getActiveBlock(ctx: Context): Result =
    doGet(ctx, "/child/active-block")

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
   * GET /child/app-rules
   * Возвращает {rules: [{packageName, mode, source}]}.
   * Включает HARDCODED первыми. Тянется при FCM SYNC_RULES, при старте app,
   * раз в 6 ч.
   */
  fun getAppRules(ctx: Context): Result =
    doGet(ctx, "/child/app-rules")

  /**
   * v0.49 Phase 6.x — расписание автоблокировки.
   *
   * GET /child/schedules
   * Возвращает {schedules: [{id, name, enabled, daysMask, startMin, endMin, mode, …}]}.
   * Тянется при FCM SYNC_SCHEDULES, при старте app, раз в 15 мин (BlockPollWorker).
   */
  fun getSchedules(ctx: Context): Result =
    doGet(ctx, "/child/schedules")

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

  private fun doGet(ctx: Context, path: String): Result {
    val token = NativeCreds.getToken(ctx)
    val baseUrl = NativeCreds.getApiBaseUrl(ctx)
    if (token.isNullOrEmpty() || baseUrl.isNullOrEmpty()) {
      DiagLog.write(ctx, TAG, "GET $path skipped — no creds")
      return Result(ok = false, statusCode = 0, bodyJson = null)
    }
    val urlStr = baseUrl.trimEnd('/') + path
    var conn: HttpURLConnection? = null
    return try {
      val url = URL(urlStr)
      conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        doInput = true
        setRequestProperty("Accept", "application/json")
        setRequestProperty("X-Child-Token", token)
        setRequestProperty("User-Agent", "periscop-child-worker/0.39")
      }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val body = stream?.let {
        BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
      } ?: ""
      val json = if (body.isNotEmpty() && body.startsWith("{")) {
        try { JSONObject(body) } catch (_: Throwable) { null }
      } else null
      val ok = code in 200..299
      if (!ok) {
        val short = if (body.length > 300) body.take(300) + "…" else body
        DiagLog.write(ctx, TAG, "GET $path → $code: $short")
      }
      Result(ok = ok, statusCode = code, bodyJson = json)
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "GET $path FAILED: ${e.javaClass.simpleName}: ${e.message}")
      Result(ok = false, statusCode = -1, bodyJson = null)
    } finally {
      conn?.disconnect()
    }
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
