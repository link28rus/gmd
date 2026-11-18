package pro.periscop.child

/** Оценивает присутствие по координатам телефона. Вызывается под блокировкой BlockManager. */
internal class ZoneBlockEvaluator {
    data class Zone(
        val id: String,
        val name: String,
        val centerLat: Double,
        val centerLon: Double,
        val radius: Int,
    ) {
        fun sameArea(other: Zone) =
            centerLat == other.centerLat && centerLon == other.centerLon && radius == other.radius
    }

    data class Fix(
        val lat: Double,
        val lon: Double,
        val accuracy: Double,
        val elapsedMs: Long,
    )

    private class Presence(var zone: Zone) {
        var lastInsideMs: Long? = null
        var pendingSinceMs: Long? = null

        fun isInside(nowMs: Long) = lastInsideMs?.let { nowMs - it in 0 until INSIDE_TTL_MS } == true
    }

    private var zones = emptyMap<String, Presence>()
    private var lastFixMs: Long? = null
    private var needsInitialFix = false

    fun replaceZones(next: List<Zone>) {
        zones = next.associate { zone ->
            val previous = zones[zone.id]
            val presence = if (previous != null && previous.zone.sameArea(zone)) {
                previous.apply { this.zone = zone }
            } else {
                needsInitialFix = true
                Presence(zone)
            }
            zone.id to presence
        }
        if (zones.isEmpty()) {
            lastFixMs = null
            needsInitialFix = false
        }
    }

    fun observe(fix: Fix, nowMs: Long) {
        if (zones.isEmpty() || fix.accuracy !in 0.0..MAX_ACCURACY_M ||
            nowMs - fix.elapsedMs !in 0..MAX_FIX_AGE_MS ||
            fix.elapsedMs <= (lastFixMs ?: -1L)
        ) return

        lastFixMs = fix.elapsedMs
        needsInitialFix = false
        for (presence in zones.values) {
            val zone = presence.zone
            val distance = haversineMeters(zone.centerLat, zone.centerLon, fix.lat, fix.lon)
            val inside = presence.isInside(fix.elapsedMs)
            if (!inside && presence.lastInsideMs != null) {
                presence.lastInsideMs = null
                presence.pendingSinceMs = null
            }
            val observedInside = when {
                distance + fix.accuracy <= zone.radius -> true
                distance - fix.accuracy > zone.radius + maxOf(30.0, zone.radius * 0.15) -> false
                else -> continue
            }
            if (inside == observedInside) {
                presence.pendingSinceMs = null
                if (inside) presence.lastInsideMs = fix.elapsedMs
            } else {
                val pending = presence.pendingSinceMs
                if (pending == null || fix.elapsedMs - pending > MAX_FIX_AGE_MS) {
                    presence.pendingSinceMs = fix.elapsedMs
                } else if (fix.elapsedMs - pending >= CONFIRM_MS) {
                    presence.lastInsideMs = if (observedInside) fix.elapsedMs else null
                    presence.pendingSinceMs = null
                }
            }
        }
    }

    fun activeZone(nowMs: Long): Zone? =
        zones.values.firstOrNull { it.isInside(nowMs) }?.zone

    fun confirmedPresence(
        nowMs: Long,
        nextZones: Collection<Zone> = zones.values.map { it.zone },
    ): Map<String, Long> = buildMap {
        for (zone in nextZones) {
            val previous = zones[zone.id] ?: continue
            val lastInside = previous.lastInsideMs ?: continue
            if (previous.zone.sameArea(zone) && previous.isInside(nowMs)) put(zone.id, lastInside)
        }
    }

    fun restorePresence(saved: Map<String, Long>, nowMs: Long) {
        for ((id, elapsedMs) in saved) {
            if (elapsedMs <= 0 || nowMs - elapsedMs !in 0 until INSIDE_TTL_MS) continue
            val presence = zones[id] ?: continue
            presence.lastInsideMs = elapsedMs
            lastFixMs = maxOf(lastFixMs ?: 0, elapsedMs)
        }
    }

    fun needsFix(nowMs: Long): Boolean {
        if (zones.isEmpty()) return false
        if (needsInitialFix) return true
        val age = nowMs - (lastFixMs ?: return true)
        return age >= REFRESH_MS ||
            (age >= CONFIRM_MS && zones.values.any { it.pendingSinceMs != null })
    }

    private companion object {
        const val MAX_ACCURACY_M = 75.0
        const val CONFIRM_MS = 30_000L
        const val MAX_FIX_AGE_MS = 3 * 60_000L
        const val REFRESH_MS = 4 * 60_000L
        const val INSIDE_TTL_MS = 10 * 60_000L
    }
}

internal fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = Math.sin(dLat / 2).let { it * it } +
        Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
        Math.sin(dLon / 2).let { it * it }
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
