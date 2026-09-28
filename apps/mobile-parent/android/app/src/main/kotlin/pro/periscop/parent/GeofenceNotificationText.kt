package pro.periscop.parent

import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * v0.59.0: текст уведомления о геозоне (GEOFENCE_ENTER / GEOFENCE_EXIT).
 * Чистая функция без Android API — покрыта JUnit `GeofenceNotificationTextTest`.
 *
 * Обычный случай — как раньше: «Тимофей вошёл в зону «Школа».».
 *
 * Запоздавшее событие (`delayed == "1"` в data-message: сервер получил точку
 * позже чем через 3 минуты после события — ребёнок был без сети, телефон
 * дослал точки пачкой) — с реальным локальным временем события из
 * `recordedAt` и пометкой:
 * «Тимофей вошёл в зону «Школа» в 08:40 — данные пришли с опозданием.».
 * Событие не сегодняшнего дня — с датой: «… 27.09 в 08:40 — …».
 *
 * java.time не используем: minSdk приложения 24, а java.time без desugaring
 * доступен только с API 26.
 */
object GeofenceNotificationText {
    const val LATE_NOTE = "данные пришли с опозданием"

    /** Форматы `Date.toISOString()` бэкенда (всегда UTC, с `Z`). */
    private val ISO_PATTERNS = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
    )

    fun body(
        enter: Boolean,
        childName: String,
        zoneName: String?,
        delayed: Boolean,
        recordedAtIso: String?,
        timeZone: TimeZone = TimeZone.getDefault(),
        nowMs: Long = System.currentTimeMillis(),
    ): String {
        val action = when {
            enter && zoneName != null -> "вошёл в зону «$zoneName»"
            enter -> "вошёл в одну из геозон"
            zoneName != null -> "вышел из зоны «$zoneName»"
            else -> "вышел из одной из геозон"
        }
        if (!delayed) return "$childName $action."
        val at = recordedAtIso
            ?.let { parseIsoUtc(it) }
            ?.let { " " + formatWhen(it, timeZone, nowMs) }
            .orEmpty()
        return "$childName $action$at — $LATE_NOTE."
    }

    /** ISO-8601 UTC → epoch ms; null, если строка не распознана. */
    fun parseIsoUtc(iso: String): Long? {
        for (pattern in ISO_PATTERNS) {
            val fmt = SimpleDateFormat(pattern, Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
                isLenient = false
            }
            val parsed = try {
                fmt.parse(iso)
            } catch (e: ParseException) {
                null // пробуем следующий формат
            }
            if (parsed != null) return parsed.time
        }
        return null
    }

    /** «в 08:40» для сегодняшнего (по [timeZone]) дня, иначе «27.09 в 08:40». */
    private fun formatWhen(eventMs: Long, timeZone: TimeZone, nowMs: Long): String {
        val event = Calendar.getInstance(timeZone).apply { timeInMillis = eventMs }
        val now = Calendar.getInstance(timeZone).apply { timeInMillis = nowMs }
        val sameDay = event.get(Calendar.YEAR) == now.get(Calendar.YEAR) &&
            event.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR)
        val time = SimpleDateFormat("HH:mm", Locale.US)
            .apply { this.timeZone = timeZone }
            .format(Date(eventMs))
        if (sameDay) return "в $time"
        val date = SimpleDateFormat("dd.MM", Locale.US)
            .apply { this.timeZone = timeZone }
            .format(Date(eventMs))
        return "$date в $time"
    }
}
