package ru.link28rus.gmd.child

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * v0.44 — расписание периодической проверки обновлений.
 *
 * Periodic 6 часов (баланс: достаточно часто чтобы не пропустить релиз надолго,
 * редко чтобы не жрать батарею; constraint NETWORK CONNECTED — без сети worker
 * откладывается без ругани).
 *
 * Триггеры schedule():
 *   • MainActivity.onCreate (когда юзер всё-таки открывает app)
 *   • BootReceiver (выживаем ребут — periodic worker'ы Android чистит при ребуте)
 *   • LocationForegroundService.onCreate (защита если MainActivity никогда не
 *     открывали — service всё равно поднимается через autostart на boot)
 *
 * Все триггеры идемпотентны через ExistingPeriodicWorkPolicy.KEEP — повторный
 * вызов не плодит запросов.
 */
object UpdateCheckScheduler {

    private const val TAG = "update_scheduler"

    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<UpdateCheckWorker>(6, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .addTag(UpdateCheckWorker.TAG)
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            UpdateCheckWorker.UNIQUE_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            req,
        )
        DiagLog.write(ctx, TAG, "scheduled UpdateCheckWorker periodic 6h (KEEP)")
    }

    /**
     * Триггерит немедленный one-time check (например при открытии MainActivity
     * или при ребуте) — не ждём 6 часов до первого periodic.
     */
    fun runNow(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<UpdateCheckWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(ctx).enqueue(req)
        DiagLog.write(ctx, TAG, "enqueued one-time UpdateCheck (manual trigger)")
    }
}
