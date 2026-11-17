package pro.periscop.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class PermissionStateReportWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        if (NativeCreds.isUnlinked(ctx) || NativeCreds.getToken(ctx).isNullOrEmpty()) return@withContext Result.success()
        // Periodic и one-time могут совпасть. Сериализуем сбор+HTTP, sequence
        // записываем до отправки: retry не откатывает более свежий слепок.
        synchronized(lock) {
            val token = NativeCreds.getToken(ctx) ?: return@synchronized Result.success()
            val prefs = ctx.getSharedPreferences("periscop_permission_state", Context.MODE_PRIVATE)
            val sequence = maxOf(prefs.getLong("sequence", 0) + 1, System.currentTimeMillis())
            if (!prefs.edit().putLong("sequence", sequence).commit()) return@synchronized Result.retry()
            val permissions = JSONObject().apply {
                PermissionStateCollector.collect(ctx).forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
            }
            val body = JSONObject().put("sequence", sequence).put("permissions", permissions)
            val response = AppControlHttp.postPermissionState(ctx, body, token)
            DiagLog.write(ctx, "permissions", "report sequence=$sequence status=${response.statusCode}")
            when {
                response.ok -> Result.success()
                response.statusCode == 401 -> { ChildEscapeOrchestrator.probe(ctx); Result.success() }
                response.statusCode == 0 || response.statusCode == -1 || response.statusCode == 429 || response.statusCode >= 500 -> Result.retry()
                else -> Result.failure()
            }
        }
    }
    companion object {
        private val lock = Any()
        const val PERIODIC_NAME = "periscop_permission_state_periodic"
        const val IMMEDIATE_NAME = "periscop_permission_state_now"
    }
}
