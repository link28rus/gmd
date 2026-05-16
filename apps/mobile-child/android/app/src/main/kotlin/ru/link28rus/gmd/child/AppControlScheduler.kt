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

    // v0.38 escape hatch: probe раз в час. Лёгкая операция, низкие constraints
    // (только NETWORK), чтобы максимально быстро задетектить child_deleted /
    // device_revoked и снять защиту с устройства.
    val escapeReq = PeriodicWorkRequestBuilder<EscapeProbeWorker>(
      1, TimeUnit.HOURS,
    )
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
      .addTag(EscapeProbeWorker.TAG)
      .build()

    // v0.39 Phase 6.2: fallback poll active-block + app-rules. FCM = main канал
    // (мгновенно), poll = страховка от Doze / отсутствия Google Play Services /
    // потерянного TTL=60с push'а.
    val blockPollReq = PeriodicWorkRequestBuilder<BlockPollWorker>(
      15, TimeUnit.MINUTES,
    )
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .addTag(BlockPollWorker.TAG)
      .build()

    // v0.51.1 fix регрессии latency (task #68 root cause): periodic refresh FCM
    // token независимо от foreground. Без него токен ротировался при обновлении
    // app через RuStore и записывался только когда ребёнок открывал app —
    // push'и не доставлялись часами/днями.
    val fcmRefreshReq = PeriodicWorkRequestBuilder<FcmTokenRefreshWorker>(
      6, TimeUnit.HOURS,
    )
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
      .addTag(FcmTokenRefreshWorker.TAG)
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
    wm.enqueueUniquePeriodicWork(
      EscapeProbeWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      escapeReq,
    )
    wm.enqueueUniquePeriodicWork(
      BlockPollWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      blockPollReq,
    )
    wm.enqueueUniquePeriodicWork(
      FcmTokenRefreshWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      fcmRefreshReq,
    )
    DiagLog.write(
      ctx,
      TAG,
      "scheduled UsageStats(15min) + InstalledApps(24h) + EscapeProbe(1h) + BlockPoll(15min) + FcmRefresh(6h) periodic (KEEP)",
    )
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
    wm.cancelUniqueWork(EscapeProbeWorker.UNIQUE_NAME)
    wm.cancelUniqueWork(BlockPollWorker.UNIQUE_NAME)
    wm.cancelUniqueWork(FcmTokenRefreshWorker.UNIQUE_NAME)
    DiagLog.write(ctx, TAG, "cancelled existing workers, re-enqueueing")
    scheduleAll(ctx)
  }

  /**
   * v0.51.1: триггерит немедленный FCM token refresh. Используется на старте
   * MainActivity (после Firebase init) чтобы сразу подтянуть/проверить токен,
   * не ждать 6 ч до первого periodic'а. Без него фикс не помогает существующим
   * установкам v0.51.0 — periodic запустится только через 6 ч после первого
   * запуска нового workmanager job'а.
   */
  fun runFcmTokenRefreshNow(ctx: Context) {
    val req = androidx.work.OneTimeWorkRequestBuilder<FcmTokenRefreshWorker>()
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .build()
    WorkManager.getInstance(ctx).enqueue(req)
    DiagLog.write(ctx, TAG, "enqueued one-time FcmTokenRefresh run (manual trigger)")
  }

  /**
   * Триггерит немедленный poll active-block + app-rules. Используется на старте
   * MainActivity чтобы сразу подтянуть актуальное состояние (не ждать 15 мин
   * до первого periodic'а), а также после grant'а Accessibility — чтобы тут же
   * получить правила и активную сессию из backend'а.
   */
  fun runBlockPollNow(ctx: Context) {
    val req = androidx.work.OneTimeWorkRequestBuilder<BlockPollWorker>()
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .build()
    WorkManager.getInstance(ctx).enqueue(req)
    DiagLog.write(ctx, TAG, "enqueued one-time BlockPoll run (manual trigger)")
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
