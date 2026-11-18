package pro.periscop.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** Сначала сохраняем накопленные итоги локально, затем отправляем, включая офлайн-хвост. */
class UsageStatsReportWorker(ctx: Context, params: WorkerParameters): CoroutineWorker(ctx,params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val token = NativeCreds.getToken(ctx) ?: return@withContext Result.success()
        if (!AppControlNative.hasUsageStatsPermission(ctx)) return@withContext Result.success()
        val snapshot=UsagePeriods.snapshot(ctx,token) ?: return@withContext Result.success()
        val now=snapshot.at
        val rows = try {
            snapshot.periods.filter { it.end == null || it.end >= now-7*86400_000L }.flatMap { p ->
                AppControlNative.collectUsageBuckets(ctx,7,p.start,p.end ?: now,p.zone,p.id)
            }
        } catch (e: Exception) {
            DiagLog.write(ctx,TAG,"usage unavailable: ${e.javaClass.simpleName}")
            return@withContext Result.retry()
        }
        var payload: List<AppControlNative.UsageBucketPayload> = emptyList()
        var clockChanged=false
        if (!NativeCreds.withCurrent(ctx,token) {
            // TIME_SET/TZ во время queryEvents отменяет весь устаревший расчёт.
            // Drift проверяется и до доставки системного broadcast.
            if(!UsagePeriods.isCurrent(ctx,snapshot)) { clockChanged=true; return@withCurrent }
            val prefs = ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE)
            val previous = try { JSONArray(prefs.getString("buckets","[]")) } catch (_: Exception) { JSONArray() }
            val map = linkedMapOf<String,JSONObject>()
            val oldest = LocalDate.now().minusDays(29).toString()
            for(i in 0 until previous.length()) {
                val obj = previous.optJSONObject(i) ?: continue
                if (obj.optString("date") >= oldest && obj.has("epoch")) map[key(obj)] = obj
            }
            for(row in rows) {
                val obj = JSONObject().put("date",row.date).put("hour",row.hour).put("packageName",row.packageName).put("seconds",row.seconds).put("epoch",row.epoch)
                val old = map[key(obj)]
                // Системная история может уже быть обрезана. Подтверждённый накопленный итог не уменьшаем.
                if (old == null || row.seconds > old.optInt("seconds")) map[key(obj)] = obj
            }
            val saved = JSONArray(map.values.toList())
            prefs.edit().putString("buckets",saved.toString()).commit()
            payload = map.values.map { AppControlNative.UsageBucketPayload(it.getString("date"),it.getInt("hour"),it.getString("packageName"),it.getInt("seconds"),it.getString("epoch")) }
        }) return@withContext Result.success()
        if(clockChanged) return@withContext Result.retry()
        // Даже пустой отчёт сообщает, что сбор работает, а не маскирует отсутствие доступа.
        val chunks = if(payload.isEmpty()) listOf(emptyList()) else payload.chunked(4000)
        for(chunk in chunks) {
            if (NativeCreds.getToken(ctx) != token) return@withContext Result.success()
            val res = AppControlHttp.postUsageReport(ctx,AppControlNative.deviceTimezone(),chunk,token)
            if (!res.ok) return@withContext if(res.statusCode in listOf(400,401,403)) Result.failure() else Result.retry()
        }
        Result.success()
    }
    private fun key(obj: JSONObject) = "${obj.getString("epoch")}|${obj.getString("date")}|${obj.getInt("hour")}|${obj.getString("packageName")}"
    companion object {
        const val TAG = "usage_stats_worker"
        const val UNIQUE_NAME = "periscop_usage_stats_periodic"
        const val PREFS = "periscop_usage_cache"
    }
}
