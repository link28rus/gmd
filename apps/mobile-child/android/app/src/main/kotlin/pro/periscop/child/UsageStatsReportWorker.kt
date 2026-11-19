package pro.periscop.child

import android.content.Context
import android.content.SharedPreferences
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
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!AppControlNative.hasUsageStatsPermission(ctx)) {
            // Не отмечаем время без доступа к статистике как отсутствие активности.
            NativeCreds.withCurrent(ctx, token) {
                prefs.edit().putLong(WINDOW_CURSOR, System.currentTimeMillis()).commit()
            }
            return@withContext Result.success()
        }
        val snapshot=UsagePeriods.snapshot(ctx,token) ?: return@withContext Result.success()
        val now=snapshot.at
        // Не обещаем покрытие за более старые данные: срок системной истории зависит от Android.
        val detailsFrom = prefs.getLong(WINDOW_CURSOR, now).takeIf { it <= now }
            ?.coerceAtLeast(now - DAY_MS) ?: now
        val collected = try {
            snapshot.periods.filter { it.end == null || it.end >= now-7*DAY_MS }.map { p ->
                AppControlNative.collectUsage(ctx, 7, p.start, p.end ?: now, p.zone, p.id, detailsFrom)
            }
        } catch (e: Exception) {
            DiagLog.write(ctx,TAG,"usage unavailable: ${e.javaClass.simpleName}")
            return@withContext Result.retry()
        }
        var payload: List<AppControlNative.UsageBucketPayload> = emptyList()
        var windows: List<JSONObject> = emptyList()
        var saved = false
        if (!NativeCreds.withCurrent(ctx,token) {
            // TIME_SET/TZ во время queryEvents отменяет весь устаревший расчёт.
            // Drift проверяется и до доставки системного broadcast.
            if (!UsagePeriods.isCurrent(ctx, snapshot) || !AppControlNative.hasUsageStatsPermission(ctx)) return@withCurrent
            val previous = try { JSONArray(prefs.getString("buckets","[]")) } catch (_: Exception) { JSONArray() }
            val map = linkedMapOf<String,JSONObject>()
            val oldest = LocalDate.now().minusDays(29).toString()
            for(i in 0 until previous.length()) {
                val obj = previous.optJSONObject(i) ?: continue
                if (obj.optString("date") >= oldest && obj.has("epoch")) map[key(obj)] = obj
            }
            for (row in collected.flatMap { it.buckets }) {
                val obj = JSONObject().put("date",row.date).put("hour",row.hour).put("packageName",row.packageName).put("seconds",row.seconds).put("epoch",row.epoch)
                val old = map[key(obj)]
                // Системная история может уже быть обрезана. Подтверждённый накопленный итог не уменьшаем.
                if (old == null || row.seconds > old.optInt("seconds")) map[key(obj)] = obj
            }
            val pending = readWindows(prefs, now)
            val cursor = prefs.getLong(WINDOW_CURSOR, detailsFrom).takeIf { it <= now } ?: now
            for (window in collected.flatMap { it.windows }) {
                if (window.start >= cursor) pending.putIfAbsent(window.start, serialize(window))
            }
            val capturedUntil = now / UsageTimeline.WINDOW_MS * UsageTimeline.WINDOW_MS
            saved = prefs.edit()
                .putString("buckets", JSONArray(map.values.toList()).toString())
                .putString(PENDING_WINDOWS, JSONArray(pending.values.toList()).toString())
                .putLong(WINDOW_CURSOR, maxOf(cursor, capturedUntil, detailsFrom))
                .commit()
            payload = map.values.map { AppControlNative.UsageBucketPayload(it.getString("date"),it.getInt("hour"),it.getString("packageName"),it.getInt("seconds"),it.getString("epoch")) }
            windows = pending.entries.sortedByDescending { it.key }.take(32).map { it.value }
        }) return@withContext Result.success()
        if (!saved) return@withContext Result.retry()
        // Даже пустой отчёт сообщает, что сбор работает, а не маскирует отсутствие доступа.
        val chunks = if(payload.isEmpty()) listOf(emptyList()) else payload.chunked(4000)
        for(chunk in chunks) {
            if (NativeCreds.getToken(ctx) != token) return@withContext Result.success()
            val res = AppControlHttp.postUsageReport(ctx,AppControlNative.deviceTimezone(),chunk,token)
            if (!res.ok) return@withContext if(res.statusCode in listOf(400,401,403)) Result.failure() else Result.retry()
        }
        if (windows.isNotEmpty() && NativeCreds.getToken(ctx) == token) {
            val res = AppControlHttp.postUsageReport(ctx, AppControlNative.deviceTimezone(), emptyList(), token, windows)
            // Старый сервер отвергает новое поле. Обычный отчёт уже доставлен, окна ждут обновления.
            if (res.statusCode == 400) return@withContext Result.success()
            if (!res.ok) return@withContext if (res.statusCode in listOf(401, 403)) Result.failure() else Result.retry()
            NativeCreds.withCurrent(ctx, token) {
                val pending = readWindows(prefs, System.currentTimeMillis())
                for (window in windows) pending.remove(window.getLong("startMs"))
                prefs.edit().putString(PENDING_WINDOWS, JSONArray(pending.values.toList()).toString()).apply()
            }
        }
        Result.success()
    }

    private fun readWindows(prefs: SharedPreferences, now: Long): MutableMap<Long, JSONObject> {
        val data = try { JSONArray(prefs.getString(PENDING_WINDOWS, "[]")) } catch (_: Exception) { JSONArray() }
        val pending = mutableMapOf<Long, JSONObject>()
        for (index in 0 until data.length()) {
            val window = data.optJSONObject(index) ?: continue
            val start = window.optLong("startMs", -1)
            if (start >= now - 30 * DAY_MS) pending[start] = window
        }
        return pending
    }

    private fun serialize(window: UsageTimeline.Window) = JSONObject()
        .put("startMs", window.start)
        .put("segments", JSONArray(window.segments.map { JSONArray(listOf(it.packageName, it.from, it.to)) }))

    private fun key(obj: JSONObject) = "${obj.getString("epoch")}|${obj.getString("date")}|${obj.getInt("hour")}|${obj.getString("packageName")}"
    companion object {
        const val TAG = "usage_stats_worker"
        const val UNIQUE_NAME = "periscop_usage_stats_periodic"
        const val PREFS = "periscop_usage_cache"
        private const val DAY_MS = 86_400_000L
        private const val WINDOW_CURSOR = "windowCursor"
        private const val PENDING_WINDOWS = "pendingWindows"
    }
}
