package pro.periscop.child

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * v0.49 Phase 6.x — расписание автоблокировки приложений (mobile-child side).
 *
 * Pure-логика «активно ли расписание сейчас» + helper для расчёта момента
 * окончания текущего окна (для overlay countdown).
 *
 * **Parity** с backend `ScheduleService.isActiveAt`
 * (apps/backend/src/app-control/schedule.service.ts:197). Тесты в
 * `ScheduleEvaluatorTest.kt` повторяют 28 кейсов из
 * `apps/backend/src/app-control/schedule.service.spec.ts`.
 *
 * **Семантика weekday-маски (важно):**
 *   - `daysMask` — 7-битное число.
 *   - bit 0 = ПН, bit 1 = ВТ, … bit 6 = ВС (ISO weekday: Mon=1 .. Sun=7).
 *   - Шаблон: `MASK_WEEKDAYS = 0b0011111 = 31`, `MASK_WEEKEND = 0b1100000 = 96`.
 *
 * **Cross-midnight:** если `startMin > endMin` — окно пересекает полночь
 * (например 22:00 → 08:00). Активно, если:
 *   - сегодня (день в маске) и time >= startMin (head того же дня), ИЛИ
 *   - вчера (день в маске) и time < endMin (tail с прошлого дня).
 *
 * **Граничные минуты:** start inclusive, end exclusive — т.е. окно `[startMin, endMin)`.
 */
object ScheduleEvaluator {

    /** v1: единственный режим — whitelist (как при BlockSession). */
    const val MODE_BLOCK_NON_ALLOWED = "BLOCK_NON_ALLOWED"

    data class Schedule(
        val id: String,
        val name: String,
        val enabled: Boolean,
        val daysMask: Int,
        /** Минуты с полуночи 0..1439 в TZ ребёнка. */
        val startMin: Int,
        /** Минуты с полуночи 0..1439 в TZ ребёнка. */
        val endMin: Int,
        val mode: String,
    )

    /**
     * Активно ли расписание в момент `nowMs` для устройства с TZ `tzId`?
     *
     * @param schedule расписание
     * @param nowMs момент времени (epoch millis, обычно `System.currentTimeMillis()`)
     * @param tzId IANA-id TZ ребёнка (e.g. "Europe/Moscow"). Берётся из
     *             `TimeZone.getDefault().id` на устройстве.
     */
    fun isActiveAt(schedule: Schedule, nowMs: Long, tzId: String): Boolean {
        if (!schedule.enabled) return false
        if (schedule.startMin == schedule.endMin) return false

        val zone = safeZone(tzId)
        val zdt = Instant.ofEpochMilli(nowMs).atZone(zone)
        val weekday = zdt.dayOfWeek.value // 1..7 (Mon..Sun)
        val minute = zdt.hour * 60 + zdt.minute

        val todayBit = isoWeekdayBit(weekday)
        val yesterdayBit = isoWeekdayBit(if (weekday == 1) 7 else weekday - 1)

        return if (schedule.startMin < schedule.endMin) {
            // Прямое окно — только в день из маски.
            (schedule.daysMask and todayBit) != 0 &&
                minute >= schedule.startMin &&
                minute < schedule.endMin
        } else {
            // Cross-midnight (22:00 → 08:00):
            //   (a) день в маске вчера И minute < endMin → активно сегодня до endMin (хвост вчерашнего)
            //   (b) день в маске сегодня И minute >= startMin → активно сегодня после startMin
            val tailFromYesterday =
                (schedule.daysMask and yesterdayBit) != 0 && minute < schedule.endMin
            val headFromToday =
                (schedule.daysMask and todayBit) != 0 && minute >= schedule.startMin
            tailFromYesterday || headFromToday
        }
    }

    /**
     * Возвращает первое активное расписание из списка или null.
     * Для overlay (showing «Сейчас режим X, до HH:MM»).
     */
    fun firstActive(schedules: List<Schedule>, nowMs: Long, tzId: String): Schedule? =
        schedules.firstOrNull { isActiveAt(it, nowMs, tzId) }

    /**
     * Момент окончания текущего активного окна расписания (epoch millis).
     *
     * Для прямого окна: сегодня в endMin (в TZ ребёнка).
     * Для cross-midnight tail: сегодня в endMin (в TZ ребёнка).
     * Для cross-midnight head: завтра в endMin (в TZ ребёнка).
     *
     * Контракт: caller гарантирует что [isActiveAt] вернул true для этого
     * `nowMs`. Иначе результат не определён (но безопасен — вернёт epoch
     * future-момент).
     */
    fun windowEndMs(schedule: Schedule, nowMs: Long, tzId: String): Long {
        val zone = safeZone(tzId)
        val nowZdt = Instant.ofEpochMilli(nowMs).atZone(zone)
        val today: LocalDate = nowZdt.toLocalDate()
        val minute = nowZdt.hour * 60 + nowZdt.minute

        // Решаем какой день использовать для endMin.
        val endDate: LocalDate = if (schedule.startMin < schedule.endMin) {
            // Прямое окно — endMin сегодня в TZ ребёнка.
            today
        } else {
            // Cross-midnight: либо tail (minute < endMin → endMin сегодня),
            // либо head (minute >= startMin → endMin завтра).
            if (minute < schedule.endMin) today else today.plusDays(1)
        }

        val endTime = LocalTime.of(schedule.endMin / 60, schedule.endMin % 60)
        return LocalDateTime.of(endDate, endTime)
            .atZone(zone)
            .toInstant()
            .toEpochMilli()
    }

    /**
     * Парсит JSON-массив расписаний из `GET /child/schedules` body.
     *
     * Backend DTO ([apps/backend/src/app-control/dto/schedule.dto.ts]):
     *   {id, name, enabled, daysMask, startMin, endMin, startTime, endTime,
     *    crossesMidnight, mode, createdAt, updatedAt}
     *
     * Берём только нужные поля; `startTime/endTime` — derived (вычисляются
     * из startMin/endMin при необходимости через [formatMinutes]).
     */
    fun parseFromJsonArray(arr: JSONArray): List<Schedule> {
        val out = mutableListOf<Schedule>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            try {
                out.add(parseFromJsonObject(obj))
            } catch (_: Throwable) {
                // skip malformed
            }
        }
        return out
    }

    fun parseFromJsonObject(obj: JSONObject): Schedule = Schedule(
        id = obj.getString("id"),
        name = obj.optString("name", ""),
        enabled = obj.optBoolean("enabled", true),
        daysMask = obj.getInt("daysMask"),
        startMin = obj.getInt("startMin"),
        endMin = obj.getInt("endMin"),
        mode = obj.optString("mode", MODE_BLOCK_NON_ALLOWED),
    )

    /** "HH:MM" формат для UI / overlay subtitle. */
    fun formatMinutes(min: Int): String {
        val safe = ((min % 1440) + 1440) % 1440
        val h = safe / 60
        val m = safe % 60
        return "%02d:%02d".format(h, m)
    }

    private fun isoWeekdayBit(weekday: Int): Int = 1 shl (weekday - 1)

    private fun safeZone(tzId: String): ZoneId = try {
        ZoneId.of(tzId)
    } catch (_: Throwable) {
        ZoneId.systemDefault()
    }

    @Suppress("unused")
    private fun dayOfWeekToIso(d: DayOfWeek): Int = d.value

    @Suppress("unused")
    private fun zdtForTest(nowMs: Long, tzId: String): ZonedDateTime =
        Instant.ofEpochMilli(nowMs).atZone(safeZone(tzId))
}
