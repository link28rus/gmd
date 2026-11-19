package pro.periscop.child

import java.util.Locale

internal data class BlockScreen(val title: String, val endsAtMs: Long? = null) {
    fun countdown(nowMs: Long): String? {
        val endsAt = endsAtMs ?: return null
        val seconds = ((endsAt - nowMs).coerceAtLeast(0) + 999) / 1000
        val hours = seconds / 3600
        val minutes = seconds / 60 % 60
        return if (hours > 0) String.format(Locale.ROOT, "%02d:%02d:%02d", hours, minutes, seconds % 60)
        else String.format(Locale.ROOT, "%02d:%02d", minutes, seconds % 60)
    }

    companion object {
        fun pause(reason: String?, endsAtMs: Long) =
            BlockScreen(reason?.takeUnless { it.isBlank() } ?: "Время отдыха", endsAtMs)
    }
}
