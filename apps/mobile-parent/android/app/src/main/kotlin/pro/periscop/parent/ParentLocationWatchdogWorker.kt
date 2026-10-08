package pro.periscop.parent

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * v0.70.0 — сторож фоновой геолокации родителя: раз в 15 мин (минимум
 * WorkManager) поднимает [ParentLocationService], если её убила система или
 * OEM-оптимизатор. Живую службу не трогает.
 */
class ParentLocationWatchdogWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        ParentLocationService.ensureStarted(applicationContext, "watchdog", fromBackground = true)
        return Result.success()
    }

    companion object {
        private const val UNIQUE_NAME = "parent_location_watchdog"

        /** Идемпотентно (KEEP). */
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<ParentLocationWatchdogWorker>(15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(ctx)
                .enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(UNIQUE_NAME)
        }
    }
}
