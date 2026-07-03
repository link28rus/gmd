package pro.periscop.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONObject

/**
 * v0.39 Phase 6.2: fallback poll для блок-сессии и правил.
 *
 * FCM — основной канал: backend шлёт BLOCK_APPS / UNBLOCK_APPS / SYNC_RULES,
 * child реагирует мгновенно. Этот worker — страховка для случаев:
 *   - Google Play Services отключены / нет регистрации FCM token
 *   - Doze / fast doze / OEM agressive battery (MIUI Pure Mode и т.п.)
 *   - Просто потеря FCM-сообщения (TTL 60с в сервисе → если устройство было
 *     offline дольше — push не доставится)
 *
 * Period: 15 мин (минимум для WorkManager periodic). Это хуже чем FCM ~3 сек,
 * но лучше чем «никогда» = бесконечная блокировка после parent stop.
 *
 * Логика:
 *   1) GET /child/active-block → синхронизируем BlockManager
 *      (если backend говорит «нет сессии» а локально активна — clearActiveBlock)
 *   2) GET /child/app-rules → синхронизируем whitelist
 *
 * Никогда не возвращаем Result.retry(): через 15 мин всё равно повторим, нет
 * смысла спамить retry на network error.
 */
class BlockPollWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        if (NativeCreds.getToken(ctx).isNullOrEmpty()) {
            DiagLog.write(ctx, TAG, "skip — no device-token")
            return Result.success()
        }

        // 1) Active block sync
        try {
            val res = AppControlHttp.getActiveBlock(ctx)
            if (res.ok && res.bodyJson != null) {
                applyActiveBlockResponse(ctx, res.bodyJson)
                // v0.51.1 (task #68): backend сигналит что у нас orphaned FCM-token
                // (NULL в БД) — триггерим one-time FcmTokenRefreshWorker. Работает
                // независимо от того открывает ли ребёнок app (этот worker и так
                // запускается из foreground service).
                if (res.bodyJson.optBoolean("forceFcmRefresh", false)) {
                    DiagLog.write(ctx, TAG, "backend signaled forceFcmRefresh=true — enqueuing FcmTokenRefreshWorker")
                    AppControlScheduler.runFcmTokenRefreshNow(ctx)
                }
            } else {
                DiagLog.write(ctx, TAG, "active-block GET failed: status=${res.statusCode}")
            }
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "active-block exception: ${e.javaClass.simpleName}: ${e.message}")
        }

        // 2) Rules sync
        try {
            val res = AppControlHttp.getAppRules(ctx)
            if (res.ok && res.bodyJson != null) {
                BlockManager.applyRulesFromJsonObject(ctx, res.bodyJson)
            } else {
                DiagLog.write(ctx, TAG, "app-rules GET failed: status=${res.statusCode}")
            }
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "app-rules exception: ${e.javaClass.simpleName}: ${e.message}")
        }

        // 3) Schedules sync (v0.49 Phase 6.x).
        try {
            val res = AppControlHttp.getSchedules(ctx)
            if (res.ok && res.bodyJson != null) {
                BlockManager.applySchedulesFromJsonObject(ctx, res.bodyJson)
            } else {
                DiagLog.write(ctx, TAG, "schedules GET failed: status=${res.statusCode}")
            }
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "schedules exception: ${e.javaClass.simpleName}: ${e.message}")
        }

        return Result.success()
    }

    companion object {
        const val TAG = "block_poll_worker"
        const val UNIQUE_NAME = "periscop_block_poll_periodic"

        /**
         * Применить ответ GET /child/active-block к BlockManager:
         *   {session: {sessionId, startedAt, endsAt}}  → setActiveBlock
         *   {session: null}                            → clearActiveBlock
         *
         * Доступно как companion-функция чтобы переиспользовать из MainActivity
         * (sync при старте app) и из других worker'ов.
         */
        fun applyActiveBlockResponse(ctx: Context, body: JSONObject) {
            val sessionObj = body.optJSONObject("session")
            if (sessionObj == null || sessionObj.isNull("sessionId")) {
                BlockManager.clearActiveBlock(ctx, "poll-no-active")
                return
            }
            val sessionId = sessionObj.optString("sessionId")
            val endsAtIso = sessionObj.optString("endsAt")
            val endsAtMs = parseIsoToMs(endsAtIso) ?: run {
                DiagLog.write(ctx, TAG, "unparseable endsAt=$endsAtIso — clearing")
                BlockManager.clearActiveBlock(ctx, "poll-bad-endsAt")
                return
            }
            BlockManager.setActiveBlock(ctx, sessionId, endsAtMs)
        }

        private fun parseIsoToMs(iso: String): Long? = try {
            java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                java.util.Locale.US,
            ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                .parse(iso)?.time
        } catch (_: Throwable) {
            null
        }
    }
}
