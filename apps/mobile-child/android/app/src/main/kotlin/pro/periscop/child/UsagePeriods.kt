package pro.periscop.child

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone

/** История не пересчитывается при смене пояса или коррекции системных часов. */
object UsagePeriods {
    data class Period(val start: Long, val zone: String, val end: Long? = null, val id: String = start.toString())
    data class Snapshot(val at: Long, val elapsed: Long, val generation: Long, val periods: List<Period>)

    fun clockMatches(snapshot: Snapshot, generation: Long, wall: Long, elapsed: Long): Boolean =
        generation == snapshot.generation &&
            kotlin.math.abs((wall-snapshot.at)-(elapsed-snapshot.elapsed)) <= 2000L

    fun snapshot(ctx: Context, token: String): Snapshot? {
        var result: Snapshot? = null
        NativeCreds.withCurrent(ctx,token) {
            val now=System.currentTimeMillis()
            val elapsed=android.os.SystemClock.elapsedRealtime()
            val periods=capture(ctx,now)
            val generation=ctx.getSharedPreferences(UsageStatsReportWorker.PREFS,Context.MODE_PRIVATE).getLong("generation",0L)
            result=Snapshot(now,elapsed,generation,periods)
        }
        return result
    }

    fun isCurrent(ctx: Context, snapshot: Snapshot): Boolean = clockMatches(
        snapshot,
        ctx.getSharedPreferences(UsageStatsReportWorker.PREFS,Context.MODE_PRIVATE).getLong("generation",0L),
        System.currentTimeMillis(),android.os.SystemClock.elapsedRealtime(),
    )

    fun restart(previous: List<Period>, zone: String, at: Long): List<Period> {
        val previousId = previous.maxOfOrNull { it.id.toLongOrNull() ?: it.start } ?: -1L
        return listOf(Period(at,zone,id=maxOf(at,previousId+1).toString()))
    }

    fun advance(previous: List<Period>, zone: String, now: Long, bindingStart: Long): List<Period> {
        val boundary=minOf(bindingStart,now)
        val periods=previous.filter { it.start >= boundary && (it.end == null || it.end >= now-31*86400_000L) }
        if(periods.isEmpty()) return restart(previous,zone,boundary)
        val last=periods.last()
        if(now < last.start) return restart(previous,zone,now)
        if(last.zone == zone) return periods
        return periods.dropLast(1) + last.copy(end=now) + restart(periods,zone,now)
    }

    fun capture(ctx: Context, now: Long = System.currentTimeMillis()): List<Period> {
        val token=NativeCreds.getToken(ctx) ?: return emptyList()
        var result: List<Period> = emptyList()
        NativeCreds.withCurrent(ctx,token) {
            val prefs=ctx.getSharedPreferences(UsageStatsReportWorker.PREFS,Context.MODE_PRIVATE)
            result=advance(read(prefs),TimeZone.getDefault().id,now,NativeCreds.bindingStartedAt(ctx))
            write(prefs,result)
        }
        return result
    }

    // При TIME_SET старые агрегаты остаются, а события до новой границы не импортируются повторно.
    fun restartClock(ctx: Context, now: Long) {
        val prefs=ctx.getSharedPreferences(UsageStatsReportWorker.PREFS,Context.MODE_PRIVATE)
        write(prefs,restart(read(prefs),TimeZone.getDefault().id,now))
    }

    private fun read(prefs: SharedPreferences): List<Period> {
        val arr=try { JSONArray(prefs.getString("periods","[]")) } catch (_: Exception) { JSONArray() }
        return (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let {
            Period(it.getLong("start"),it.getString("zone"),if(it.isNull("end")) null else it.getLong("end"),it.optString("id",it.getLong("start").toString()))
        } }
    }

    private fun write(prefs: SharedPreferences, periods: List<Period>) {
        val saved=JSONArray(periods.map { JSONObject().put("start",it.start).put("zone",it.zone).put("end",it.end ?: JSONObject.NULL).put("id",it.id) })
        if(prefs.getString("periods",null) != saved.toString()) {
            check(prefs.edit().putString("periods",saved.toString())
                .putLong("generation",prefs.getLong("generation",0L)+1).commit())
        }
    }
}
