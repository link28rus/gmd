package pro.periscop.child

import java.time.Instant
import java.time.ZoneId

/** Время последнего foreground-приложения при включённом, разблокированном экране. */
object UsageTimeline {
    data class Event(val at: Long, val type: Int, val pkg: String?, val activity: String? = null)
    data class Bucket(val date: String, val hour: Int, val packageName: String, val seconds: Int)
    data class Interval(val packageName: String, val from: Long, val to: Long)
    data class Window(val start: Long, val segments: List<Interval>)

    const val WINDOW_MS = 15 * 60_000L

    fun calculate(events: List<Event>, from: Long, to: Long, zone: ZoneId, own: String, excluded: Set<String> = emptySet()): List<Bucket> =
        buckets(intervals(events, from, to, own, excluded), zone)

    fun intervals(events: List<Event>, from: Long, to: Long, own: String, excluded: Set<String> = emptySet()): List<Interval> {
        val intervals = mutableListOf<Interval>()
        var active: String? = null
        var activity: String? = null
        var interactive = true
        var locked = false
        var cursor = events.firstOrNull()?.at ?: from
        fun flush(until: Long) {
            val pkg = active
            val at = maxOf(cursor, from)
            val end = minOf(until, to)
            if (at < end && pkg != null && pkg != own && pkg !in excluded && interactive && !locked) {
                val last = intervals.lastOrNull()
                if (last != null && last.packageName == pkg && last.to == at) {
                    intervals[intervals.lastIndex] = last.copy(to = end)
                } else {
                    intervals.add(Interval(pkg, at, end))
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
        return intervals
    }

    fun buckets(intervals: List<Interval>, zone: ZoneId): List<Bucket> {
        val totals = linkedMapOf<Triple<String, Int, String>, Long>()
        for (interval in intervals) {
            var at = interval.from
            while (at < interval.to) {
                val local = Instant.ofEpochMilli(at).atZone(zone)
                val next = local.withMinute(0).withSecond(0).withNano(0).plusHours(1).toInstant().toEpochMilli()
                val stop = minOf(next, interval.to)
                val key = Triple(local.toLocalDate().toString(), local.hour, interval.packageName)
                totals[key] = (totals[key] ?: 0L) + stop - at
                at = stop
            }
        }
        return totals.map { (key,ms) -> Bucket(key.first,key.second,key.third,(ms/1000).toInt()) }.filter { it.seconds > 0 }
    }

    /** Только завершённые окна внутри фактически прочитанного диапазона. */
    fun usageWindows(intervals: List<Interval>, from: Long, to: Long): List<Window> = buildList {
        var start = (from + WINDOW_MS - 1) / WINDOW_MS * WINDOW_MS
        var first = 0
        while (start + WINDOW_MS <= to) {
            val end = start + WINDOW_MS
            while (first < intervals.size && intervals[first].to <= start) first++
            val segments = buildList {
                var index = first
                while (index < intervals.size && intervals[index].from < end && size <= 128) {
                    val interval = intervals[index++]
                    add(Interval(interval.packageName, maxOf(interval.from, start) - start, minOf(interval.to, end) - start))
                }
            }
            // Слишком плотное окно считается пропуском, чтобы не выдавать неполный итог за полный.
            if (segments.size <= 128) add(Window(start, segments))
            start = end
        }
    }
}
