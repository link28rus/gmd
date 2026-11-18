package pro.periscop.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Push только будит синхронизацию. Запоздалый BLOCK/UNBLOCK никогда не применяется напрямую. */
class BlockSyncWorker(ctx: Context,params: WorkerParameters): CoroutineWorker(ctx,params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val token = NativeCreds.getToken(ctx) ?: return@withContext Result.success()
        val res = AppControlHttp.getAppControlState(ctx,token)
        if (!res.ok || res.bodyJson == null) return@withContext if(res.statusCode in listOf(401,403)) Result.failure() else Result.retry()
        val state = res.bodyJson
        try {
            if (!NativeCreds.withCurrent(ctx,token) { BlockManager.applySnapshot(ctx,state) }) return@withContext Result.success()
            PeriscopAccessibilityService.refresh()
            val ack = JSONObject().put("revision",state.getString("revision"))
                .put("accessibility",PeriscopAccessibilityService.isConnected())
                .put("usageStats",AppControlNative.hasUsageStatsPermission(ctx))
                .put("timezone",AppControlNative.deviceTimezone())
            val result = AppControlHttp.postAppControlAck(ctx,ack,token)
            AppControlScheduler.reportPermissionsNow(ctx)
            if(result.ok) Result.success() else Result.retry()
        } catch(e: Exception) {
            DiagLog.write(ctx,"app_control","sync failed: ${e.javaClass.simpleName}")
            Result.retry()
        }
    }
    companion object { const val PERIODIC_NAME = "periscop_block_sync_periodic"; const val IMMEDIATE_NAME = "periscop_block_sync_now" }
}
