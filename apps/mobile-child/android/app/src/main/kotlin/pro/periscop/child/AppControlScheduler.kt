package pro.periscop.child

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Scheduling helper для periodic worker'ов.
 *
 * Идемпотентен — при повторном вызове KEEP-policy не перезаписывает уже
 * запланированный job. Можно дёргать на каждом MainActivity.onCreate
 * и BootReceiver — это не штрафует battery.
 *
 * Дизайн:
 *  - EscapeProbeWorker: 1 ч — снять защиту, если ребёнка удалили из кабинета.
 *  - FcmTokenRefreshWorker: 6 ч — держать FCM-токен на backend'е актуальным.
 *
 * v0.58.0: блокировка приложений и экранное время временно отключены —
 * BlockPollWorker, UsageStatsReportWorker и InstalledAppsReportWorker удалены.
 * [scheduleAll] снимает их периодические задачи, оставшиеся в WorkManager
 * на устройствах после обновления со старой версии.
 *
 * Backoff: exponential, default min 30 сек.
 */
object AppControlScheduler {

  private const val TAG = "app_control_scheduler"

  /**
   * Unique-имена periodic-задач удалённых worker'ов. Классов больше нет —
   * без отмены WorkManager каждый период пытался бы их создать и падал.
   */
  private val LEGACY_UNIQUE_NAMES = listOf(
    "periscop_block_poll_periodic",
    "periscop_usage_stats_periodic",
    "periscop_installed_apps_daily",
  )

  fun scheduleAll(ctx: Context) {
    val wm = WorkManager.getInstance(ctx)

    for (name in LEGACY_UNIQUE_NAMES) {
      wm.cancelUniqueWork(name)
    }

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
      EscapeProbeWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      escapeReq,
    )
    wm.enqueueUniquePeriodicWork(
      FcmTokenRefreshWorker.UNIQUE_NAME,
      ExistingPeriodicWorkPolicy.KEEP,
      fcmRefreshReq,
    )
    DiagLog.write(
      ctx,
      TAG,
      "scheduled EscapeProbe(1h) + FcmRefresh(6h) periodic (KEEP)",
    )
  }

  /**
   * Принудительно перезаписать расписание (REPLACE). Использовать после
   * изменения политики (например при апгрейде до новой версии с другими
   * интервалами). Обычные вызовы должны идти через scheduleAll().
   */
  fun rescheduleAll(ctx: Context) {
    val wm = WorkManager.getInstance(ctx)
    wm.cancelUniqueWork(EscapeProbeWorker.UNIQUE_NAME)
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
}
