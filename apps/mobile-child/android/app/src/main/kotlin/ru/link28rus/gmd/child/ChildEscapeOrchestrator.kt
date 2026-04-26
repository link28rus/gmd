package ru.link28rus.gmd.child

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.work.WorkManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * v0.38 ESCAPE HATCH: если родитель удалил ребёнка из кабинета или сделал
 * /reset-device, child устройство должно само снять все защиты, иначе
 * Device Admin (с v0.27) и блокировки приложений (v0.39) превратят телефон
 * ребёнка в кирпич — нельзя удалить app, нельзя пользоваться.
 *
 * Логика:
 *  1. `probe()` — POST /child/auth-status с текущим device-token. Backend
 *     возвращает status:
 *       - 'active' → no-op
 *       - 'device_revoked' / 'child_deleted' → triggerEscape()
 *       - 'unknown' → no-op (вероятно ещё не клеймили; либо токен от очень
 *                          старой install — не наш кейс самоуничтожения)
 *  2. `triggerEscape(reason)`:
 *       - DiagLog (для аудита)
 *       - Snapshot SharedPreferences flag `gmd_escape_mode = true` (UI читает)
 *       - DPM.removeActiveAdmin() — снять Device Admin (можно: app-admin
 *         может revoke сам себя без user-confirmation)
 *       - NativeCreds.setProtectionEnabled(false) — кеш для AccessibilityService
 *       - WorkManager.cancelAllWork() — погасить periodic worker'ы (usage,
 *         installed apps; в v0.39 — block-session sync). Они больше не нужны.
 *       - NativeCreds.save(null, null) — стереть deviceToken/apiBaseUrl
 *       - Финальный DiagLog "escape complete — uninstall разрешён"
 *
 * Когда вызывать `probe()`:
 *  - Periodic 1h (см. EscapeProbeWorker).
 *  - При запуске MainActivity.onCreate (если creds есть).
 *  - В worker'ах (UsageStats / InstalledApps) после получения 401.
 *
 * Безопасность:
 *  - Endpoint /child/auth-status throttled 6/мин на IP — нельзя enumerate.
 *  - Сетевые ошибки (`Result.NETWORK_ERROR`) НЕ триггерят escape — иначе
 *    отсутствие интернета приведёт к стиранию защит. Только явный 410-style
 *    ответ от backend с известной причиной.
 *
 * Идемпотентно: повторный triggerEscape — no-op (флаг уже выставлен).
 */
object ChildEscapeOrchestrator {

  private const val TAG = "escape"
  private const val PREFS = "gmd_escape"
  private const val PREF_ESCAPE_MODE = "escape_mode"
  private const val PREF_LAST_REASON = "last_reason"
  private const val PREF_TRIGGERED_AT = "triggered_at"

  enum class ProbeResult { ACTIVE, REVOKED, DELETED, UNKNOWN, NETWORK_ERROR }

  fun isInEscapeMode(ctx: Context): Boolean =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PREF_ESCAPE_MODE, false)

  fun lastReason(ctx: Context): String? =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_LAST_REASON, null)

  /**
   * Дёрнуть POST /child/auth-status. Возвращает ProbeResult.
   * При REVOKED / DELETED автоматически вызывает triggerEscape — caller
   * не обязан этого делать сам.
   */
  fun probe(ctx: Context): ProbeResult {
    val token = NativeCreds.getToken(ctx)
    val baseUrl = NativeCreds.getApiBaseUrl(ctx)
    if (token.isNullOrEmpty() || baseUrl.isNullOrEmpty()) {
      // Уже нет creds — escape, скорее всего, уже произошёл, или клеймили только что.
      return ProbeResult.UNKNOWN
    }
    val urlStr = baseUrl.trimEnd('/') + "/child/auth-status"
    var conn: HttpURLConnection? = null
    return try {
      val url = URL(urlStr)
      conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 30_000
        doOutput = true
        doInput = true
        setRequestProperty("Content-Type", "application/json; charset=utf-8")
        setRequestProperty("Accept", "application/json")
        setRequestProperty("User-Agent", "gmd-child-escape/0.38")
      }
      conn.outputStream.use { os ->
        val payload = JSONObject().put("deviceToken", token).toString()
        os.write(payload.toByteArray(Charsets.UTF_8))
        os.flush()
      }
      val code = conn.responseCode
      if (code != 200) {
        DiagLog.write(ctx, TAG, "probe http=$code (treat as network error, no escape)")
        return ProbeResult.NETWORK_ERROR
      }
      val body = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
      val status = JSONObject(body).optString("status", "")
      DiagLog.write(ctx, TAG, "probe → status=$status")
      when (status) {
        "active" -> ProbeResult.ACTIVE
        "device_revoked" -> {
          triggerEscape(ctx, "device_revoked")
          ProbeResult.REVOKED
        }
        "child_deleted" -> {
          triggerEscape(ctx, "child_deleted")
          ProbeResult.DELETED
        }
        "unknown" -> ProbeResult.UNKNOWN
        else -> {
          DiagLog.write(ctx, TAG, "probe unknown status='$status' (no escape)")
          ProbeResult.NETWORK_ERROR
        }
      }
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "probe FAILED: ${e.javaClass.simpleName}: ${e.message}")
      ProbeResult.NETWORK_ERROR
    } finally {
      conn?.disconnect()
    }
  }

  /**
   * Снять все защиты и стереть creds. Идемпотентно.
   */
  fun triggerEscape(ctx: Context, reason: String) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getBoolean(PREF_ESCAPE_MODE, false)) {
      DiagLog.write(ctx, TAG, "triggerEscape: already in escape mode (reason was ${prefs.getString(PREF_LAST_REASON, "?")}), no-op")
      return
    }
    DiagLog.write(ctx, TAG, "ENTER ESCAPE MODE — reason=$reason")
    prefs.edit()
      .putBoolean(PREF_ESCAPE_MODE, true)
      .putString(PREF_LAST_REASON, reason)
      .putLong(PREF_TRIGGERED_AT, System.currentTimeMillis())
      .apply()

    // 1. Снять Device Admin (главное — это блокирует uninstall).
    try {
      val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      val admin = ChildDeviceAdminReceiver.componentName(ctx)
      if (dpm.isAdminActive(admin)) {
        dpm.removeActiveAdmin(admin)
        DiagLog.write(ctx, TAG, "removeActiveAdmin called")
      } else {
        DiagLog.write(ctx, TAG, "device admin was NOT active, skip")
      }
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "removeActiveAdmin FAILED: ${e.javaClass.simpleName}: ${e.message}")
    }

    // 2. Сбросить protection-кеш для AccessibilityService (раз сервис ещё в Settings).
    try {
      NativeCreds.setProtectionEnabled(ctx, false)
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "setProtectionEnabled(false) FAILED: ${e.message}")
    }

    // 3. Погасить все periodic worker'ы (usage, installed apps; в v0.39 — block sync).
    try {
      WorkManager.getInstance(ctx).cancelAllWork()
      DiagLog.write(ctx, TAG, "WorkManager.cancelAllWork called")
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "cancelAllWork FAILED: ${e.message}")
    }

    // 4. Стереть creds — следующий start будет как fresh install.
    try {
      NativeCreds.save(ctx, null, null)
      DiagLog.write(ctx, TAG, "NativeCreds cleared")
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "NativeCreds.save(null) FAILED: ${e.message}")
    }

    // 5. v0.39 Phase 6.2: снять активную блокировку приложений (если была).
    // Без этого AccessibilityService продолжит блокировать запуск других apps
    // даже когда родитель удалил ребёнка из кабинета — child повисает.
    try {
      BlockManager.clearActiveBlock(ctx, "escape-mode")
    } catch (e: Throwable) {
      DiagLog.write(ctx, TAG, "BlockManager.clearActiveBlock FAILED: ${e.message}")
    }

    DiagLog.write(ctx, TAG, "ESCAPE COMPLETE — uninstall теперь разрешён, UI должен показать спецэкран")
  }

  /**
   * Открыть карточку приложения в Settings (для UI EscapeScreen — кнопка
   * "Открыть настройки → Удалить").
   */
  fun openAppDetails(ctx: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
      .setData(android.net.Uri.parse("package:${ctx.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
  }
}
