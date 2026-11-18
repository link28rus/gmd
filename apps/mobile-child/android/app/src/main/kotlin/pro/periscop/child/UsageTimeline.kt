package pro.periscop.child

import java.time.Instant
import java.time.ZoneId

/** Время последнего foreground-приложения при включённом, разблокированном экране. */
object UsageTimeline {
    data class Event(val at: Long, val type: Int, val pkg: String?, val activity: String? = null)
    data class Bucket(val date: String, val hour: Int, val packageName: String, val seconds: Int)

    fun calculate(events: List<Event>, from: Long, to: Long, zone: ZoneId, own: String, excluded: Set<String> = emptySet()): List<Bucket> {
        val totals = linkedMapOf<Triple<String,Int,String>,Long>()
        var active: String? = null
        var activity: String? = null
        var interactive = true
        var locked = false
        var cursor = events.firstOrNull()?.at ?: from
        fun flush(until: Long) {
            val pkg = active
            var at = maxOf(cursor,from)
            val end = minOf(until,to)
            if (pkg != null && pkg != own && pkg !in excluded && interactive && !locked) {
                while (at < end) {
                    val local = Instant.ofEpochMilli(at).atZone(zone)
                    val next = local.withMinute(0).withSecond(0).withNano(0).plusHours(1).toInstant().toEpochMilli()
                    val stop = minOf(next,end)
                    val key = Triple(local.toLocalDate().toString(),local.hour,pkg)
                    totals[key] = (totals[key] ?: 0L) + stop-at
                    at = stop
                }
            }
            cursor = until
        }
        for (event in events) {
            if (event.at > to) break
            if (event.at < cursor) continue
            flush(event.at)
            when(event.type) {
                1 -> { active = event.pkg; activity = event.activity } // RESUMED / MOVE_TO_FOREGROUND
                2,23 -> if (active == event.pkg && (activity == event.activity || event.activity == null)) {
                    active = null; activity = null
                }
                15 -> interactive = true
                16 -> interactive = false
                17 -> locked = true
                18 -> locked = false
                26,27 -> { active = null; activity = null; interactive = false }
            }
        }
        flush(to)
        return totals.map { (key,ms) -> Bucket(key.first,key.second,key.third,(ms/1000).toInt()) }.filter { it.seconds > 0 }
    }
}
