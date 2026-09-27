package pro.periscop.parent

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * v0.56.0 — фоновая проверка обновлений раз в 6 часов (см. [AppUpdater]).
 *
 * Паритет с mobile-child: обновление встаёт само, даже если приложение давно
 * не открывали. Ставим сразу, если UI не на экране; если на экране — только
 * скачиваем, установку предложит баннер «Обновить».
 */
class AppUpdateWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val install = !AppUpdater.uiVisible
        DiagLog.write(applicationContext, "updates", "worker: запуск (install=$install)")
        AppUpdater.runCycle(applicationContext, install)
        // Ошибки уже в DiagLog; повтор — на следующем периоде, без backoff-штормов.
        return Result.success()
    }

    companion object {
        private const val UNIQUE_NAME = "app_update_check"

        /** Идемпотентно (KEEP) — можно звать на каждом старте UI. */
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<AppUpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .setRequiresBatteryNotLow(true)
                        .build(),
                )
                .build()
            WorkManager.getInstance(ctx)
                .enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
