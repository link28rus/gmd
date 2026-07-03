package pro.periscop.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * v0.38 Phase 6.1: 15-min periodic worker для отправки usage-bucket'ов.
 *
 * Стратегия:
 *  1. Если нет PACKAGE_USAGE_STATS permission → Result.success() (no-op,
 *     UI wizard разберётся когда-нибудь, мы не ретраим вечно).
 *  2. Если нет device-token → Result.success() (rare race — claim ещё не прошёл).
 *  3. collectUsageBuckets(daysBack=1) → POST /child/usage-reports.
 *     При не-2xx → Result.retry() с экспоненциальным backoff (WorkManager default).
 *     При успехе → Result.success().
 *
 * Запускается через AppControlScheduler.scheduleAll(ctx) — ENQUEUE_UNIQUE_PERIODIC,
 * KEEP-policy (если уже запланирован, не переустанавливать).
 *
 * 15 мин — это minimum WorkManager periodic interval. Чаще чаще ANR-риск + батарея.
 * Backend семантика UPSERT-replace, поэтому повторная отправка того же часа
 * корректно overwrite'ит без дубликатов.
 */
class UsageStatsReportWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  override suspend fun doWork(): Result {
    val ctx = applicationContext
    if (!AppControlNative.hasUsageStatsPermission(ctx)) {
      DiagLog.write(ctx, TAG, "skip — no PACKAGE_USAGE_STATS permission")
      return Result.success()
    }
    if (NativeCreds.getToken(ctx).isNullOrEmpty()) {
      DiagLog.write(ctx, TAG, "skip — no device-token (claim не прошёл)")
      return Result.success()
    }

    // На первом запуске берём 7 дней backfill, на регулярных — 1 день.
    // Маркер хранится в SharedPreferences. UsageStatsManager хранит ~7 дней
    // событий — это оптимум для backfill.
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val isFirstRun = !prefs.getBoolean(PREF_DID_FIRST_RUN, false)
    val daysBack = if (isFirstRun) 7 else 1

    val tz = AppControlNative.deviceTimezone()
    val buckets = AppControlNative.collectUsageBuckets(ctx, daysBack)
    DiagLog.write(ctx, TAG, "collected ${buckets.size} buckets (daysBack=$daysBack, tz=$tz)")

    val res = AppControlHttp.postUsageReport(ctx, tz, buckets)
    return when {
      res.ok -> {
        if (isFirstRun) {
          prefs.edit().putBoolean(PREF_DID_FIRST_RUN, true).apply()
          DiagLog.write(ctx, TAG, "first-run backfill done, switching to daily 1-day mode")
        }
        Result.success()
      }
      // 401/403 = token больше не валиден на бэке. Дёргаем escape-probe
      // чтобы понять причину и при необходимости выключить Device Admin etc.
      res.statusCode == 401 || res.statusCode == 403 -> {
        DiagLog.write(ctx, TAG, "auth error ${res.statusCode}, triggering escape probe")
        try {
          ChildEscapeOrchestrator.probe(ctx)
        } catch (e: Throwable) {
          DiagLog.write(ctx, TAG, "escape probe after 401 failed: ${e.message}")
        }
        Result.success()
      }
      // 4xx (кроме auth) — bug в payload, retry не поможет
      res.statusCode in 400..499 -> {
        DiagLog.write(ctx, TAG, "client error ${res.statusCode}, success-skip (bug to fix)")
        Result.success()
      }
      // 5xx / network → retry с exp backoff
      else -> {
        DiagLog.write(ctx, TAG, "transient error (status=${res.statusCode}), retry")
        Result.retry()
      }
    }
  }

  companion object {
    const val TAG = "usage_stats_worker"
    const val UNIQUE_NAME = "periscop_usage_stats_periodic"
    private const val PREFS = "periscop_app_control"
    private const val PREF_DID_FIRST_RUN = "usage_did_first_run"
  }
}
