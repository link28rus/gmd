package ru.link28rus.gmd.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.TimeUnit

/**
 * v0.51.1 fix регрессии latency push (task #68 root cause).
 *
 * Проблема: FCM-токен может ротироваться при обновлении app через RuStore
 * Console (OEM-зависимо — TECNO/POCO сбрасывают, другие нет). До этого фикса
 * новый токен записывался на backend ТОЛЬКО когда ребёнок открывал app в
 * foreground (FcmRegistrar в main.dart). Если ребёнок не открывал app сутками
 * — backend держал старый невалидный токен, push'и от parent не доставлялись,
 * срабатывал только polling fallback (BlockPollWorker раз в 15 мин).
 *
 * Решение: native CoroutineWorker, не зависящий от Dart isolate. Периодически
 * (6 ч) тянет текущий FCM-токен через `FirebaseMessaging.getInstance().getToken()`
 * (sync через `Tasks.await`), сравнивает с last-saved в `gmd_fcm` SharedPreferences,
 * при изменении POST на backend через [AppControlHttp.postFcmToken].
 *
 * Запускается из foreground-services (LocationForegroundService) которые всегда
 * живы — не зависит от того открывает ли ребёнок app.
 *
 * Симметрия с [BlockPollWorker] (lesson #20): тот же pattern CoroutineWorker +
 * AppControlHttp + NativeCreds.getToken() pre-check + DiagLog для observability.
 */
class FcmTokenRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        if (NativeCreds.getToken(ctx).isNullOrEmpty()) {
            DiagLog.write(ctx, TAG, "skip — no device-token (claim ещё не было)")
            return Result.success()
        }

        // Получаем текущий FCM-токен. `Tasks.await` блокирует worker-thread
        // (CoroutineWorker runs on Dispatchers.Default by default), но это OK —
        // WorkManager специально проектирован для такого ожидания. Timeout 30с
        // защищает от подвисания на устройствах с отсутствующим GMS.
        val token: String = try {
            Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "getToken failed: ${e.javaClass.simpleName}: ${e.message}")
            return Result.success()
        }

        if (token.isEmpty()) {
            DiagLog.write(ctx, TAG, "getToken returned empty — Firebase not ready")
            return Result.success()
        }

        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lastSaved = prefs.getString(KEY_LAST_SAVED_TOKEN, null)
        val lastSavedAt = prefs.getLong(KEY_LAST_SAVED_AT, 0L)
        val now = System.currentTimeMillis()
        val stale = now - lastSavedAt > STALE_MS

        if (token == lastSaved && !stale) {
            // Token не изменился И мы недавно его подтверждали на backend.
            // Skip POST чтобы не спамить квоту.
            return Result.success()
        }

        val reason = when {
            lastSaved == null -> "first-save"
            token != lastSaved -> "rotated"
            stale -> "stale-refresh"
            else -> "unknown"
        }
        DiagLog.write(ctx, TAG, "POST fcm-token reason=$reason prefix=${token.take(16)}…")

        val res = AppControlHttp.postFcmToken(ctx, token)
        return if (res.ok) {
            prefs.edit()
                .putString(KEY_LAST_SAVED_TOKEN, token)
                .putLong(KEY_LAST_SAVED_AT, now)
                .apply()
            DiagLog.write(ctx, TAG, "fcm-token registered on backend (status=${res.statusCode})")
            Result.success()
        } else {
            DiagLog.write(ctx, TAG, "fcm-token POST failed status=${res.statusCode} — retry next cycle")
            // Не Result.retry() — через 6 ч retry'имся периодически, нет смысла
            // спамить exponential backoff при network/backend проблеме.
            Result.success()
        }
    }

    companion object {
        const val TAG = "fcm_token_refresh_worker"
        const val UNIQUE_NAME = "gmd_fcm_token_refresh_periodic"

        private const val PREFS = "gmd_fcm"
        private const val KEY_LAST_SAVED_TOKEN = "last_saved_token"
        private const val KEY_LAST_SAVED_AT = "last_saved_at"

        // Если backend подтвердил токен > 24 ч назад — перешлём, даже если
        // value не менялось. Гарантирует что backend не «забудет» токен после
        // случайного очищения (например при retention/cleanup).
        private const val STALE_MS = 24L * 60 * 60 * 1000
    }
}
