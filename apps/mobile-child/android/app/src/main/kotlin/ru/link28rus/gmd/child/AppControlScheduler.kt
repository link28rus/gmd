package ru.link28rus.gmd.child

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * v0.38 Phase 6.1: scheduling helper для periodic worker'ов.
 *
 * Идемпотентен — при повторном вызове KEEP-policy не перезаписывает уже
 * запланированный job. Можно дёргать на каждом MainActivity.onCreate
 * и BootReceiver — это не штрафует battery.
 *
 * Дизайн:
 *  - UsageStatsReportWorker: 15 мин (минимум WorkManager periodic).
 *    Constraint: NETWORK CONNECTED (без сети нет смысла, retry помогает мало).
 *  - InstalledAppsReportWorker: 24ч.
 *    Constraint: NETWORK CONNECTED + BATTERY_NOT_LOW (тяжёлая операция,
 *    PNG-кодирование 100-300 иконок не должно убивать батарею ребёнка).
 *
 * Backoff: exponential, default min 30 сек.
 */
object AppControlScheduler {

  private const val TAG = "app_control_scheduler"

  fun scheduleAll(ctx: Context) {
    val wm = WorkManager.getInstance(ctx)

    val usageReq = PeriodicWorkRequestBuilder<UsageStatsReportWorker>(
      15, TimeUnit.MINUTES,
    )
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .addTag(UsageStatsReportWorker.TAG)
      .build()

    val appsReq = PeriodicWorkRequestBuilder<InstalledAppsReportWorker>(
      24, TimeUnit.HOURS,
    )
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .setRequiresBatteryNotLow(true)
          .build(),
      )
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
      .addTag(InstalledAppsReportWorker.TAG)
      .build()

    wm.enqueueUniquePeriodicWork(
      UsageStatsReportWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      usageReq,
    )
    wm.enqueueUniquePeriodicWork(
      InstalledAppsReportWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      appsReq,
    )
    DiagLog.write(ctx, TAG, "scheduled UsageStats(15min) + InstalledApps(24h) periodic workers (KEEP)")
  }

  /**
   * Принудительно перезаписать расписание (REPLACE). Использовать после
   * изменения политики (например при апгрейде до новой версии с другими
   * интервалами). Обычные вызовы должны идти через scheduleAll().
   */
  fun rescheduleAll(ctx: Context) {
    val wm = WorkManager.getInstance(ctx)
    wm.cancelUniqueWork(UsageStatsReportWorker.UNIQUE_NAME)
    wm.cancelUniqueWork(InstalledAppsReportWorker.UNIQUE_NAME)
    DiagLog.write(ctx, TAG, "cancelled existing workers, re-enqueueing")
    scheduleAll(ctx)
  }

  /** Триггерит немедленный запуск usage-worker (для wizard'а после grant'а). */
  fun runUsageNow(ctx: Context) {
    val req = androidx.work.OneTimeWorkRequestBuilder<UsageStatsReportWorker>()
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .build()
    WorkManager.getInstance(ctx).enqueue(req)
    DiagLog.write(ctx, TAG, "enqueued one-time UsageStats run (manual trigger)")
  }

  /** Триггерит немедленный запуск installed-apps worker'а. */
  fun runInstalledAppsNow(ctx: Context) {
    val req = androidx.work.OneTimeWorkRequestBuilder<InstalledAppsReportWorker>()
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .build()
    WorkManager.getInstance(ctx).enqueue(req)
    DiagLog.write(ctx, TAG, "enqueued one-time InstalledApps run (manual trigger)")
  }
}
