package pro.periscop.child

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Периодический триггер использует те же последовательные очереди, что push/UI. */
class AppControlRefreshWorker(ctx: Context, params: WorkerParameters): Worker(ctx,params) {
    override fun doWork(): Result {
        if (!NativeCreds.getToken(applicationContext).isNullOrEmpty() && !NativeCreds.isUnlinked(applicationContext)) {
            AppControlScheduler.syncNow(applicationContext)
            AppControlScheduler.runUsageNow(applicationContext)
        }
        return Result.success()
    }
}
