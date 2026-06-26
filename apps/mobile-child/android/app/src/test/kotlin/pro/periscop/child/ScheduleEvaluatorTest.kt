package pro.periscop.child

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * Parity-tests с backend `apps/backend/src/app-control/schedule.service.spec.ts`.
 *
 * Реализуют те же 28 кейсов:
 *   - disabled / zero-duration → false
 *   - прямое окно 08:00–22:00 (5 кейсов: 14:00, 07:59, 08:00, 22:00, 21:59)
 *   - cross-midnight 22:00–08:00 weekdays (8 кейсов)
 *   - недельная маска (2 кейса: среда vs четверг)
 *   - TZ-семантика (2 кейса: Europe/Moscow vs Asia/Vladivostok, UTC+05:30)
 *   - cross-midnight + weekend mask (5 кейсов)
 *   - граница полуночи 23:55–00:05 (4 кейса)
 *
 * **Запуск:** `cd apps/mobile-child/android && ./gradlew :app:testDebugUnitTest`
 *
 * Тесты pure-JVM (`Instant`, `ZoneId`, `LocalDateTime` доступны без Robolectric).
 * Класс `org.json.JSONObject` нужен для тестов парсинга — взят из
 * `testImplementation("org.json:json:...")` в build.gradle.kts.
 */
class ScheduleEvaluatorTest {

    private val maskMon = 1 shl 0   // 1
    private val maskWed = 1 shl 2   // 4
    private val maskWeekdays = 0b0011111  // 31 (Пн–Пт)
    private val maskWeekend = 0b1100000   // 96 (Сб+Вс)
    private val maskAll = 0b1111111       // 127

    /**
     * Создать момент времени, который в указанной TZ выглядит как
     * `YYYY-MM-DDTHH:MM:00`. Имитация helper'а `tzMoment` из backend spec.
     */
    private fun tzMoment(localDateTime: String, tzId: String): Long {
        // localDateTime формата "2026-05-06T14:00:00"
        val parts = localDateTime.split('T')
        val date = LocalDate.parse(parts[0])
        val time = LocalTime.parse(parts[1])
        return LocalDateTime.of(date, time)
            .atZone(ZoneId.of(tzId))
            .toInstant()
            .toEpochMilli()
    }

    private fun sched(
        enabled: Boolean = true,
        daysMask: Int,
        startMin: Int,
        endMin: Int,
    ) = ScheduleEvaluator.Schedule(
        id = "test",
        name = "test",
        enabled = enabled,
        daysMask = daysMask,
        startMin = startMin,
        endMin = endMin,
        mode = ScheduleEvaluator.MODE_BLOCK_NON_ALLOWED,
    )

    // ─── disabled / zero-duration ───────────────────────────────────────────

    @Test fun `disabled schedule is never active`() {
        val s = sched(enabled = false, daysMask = maskAll, startMin = 0, endMin = 60)
        assertFalse(ScheduleEvaluator.isActiveAt(s, System.currentTimeMillis(), "UTC"))
    }

    @Test fun `startMin equals endMin is never active`() {
        val s = sched(daysMask = maskAll, startMin = 60, endMin = 60)
        assertFalse(ScheduleEvaluator.isActiveAt(s, System.currentTimeMillis(), "UTC"))
    }

    // ─── прямое окно 08-22 ──────────────────────────────────────────────────

    private val tzMsk = "Europe/Moscow"
    private val direct = sched(daysMask = maskAll, startMin = 480, endMin = 1320)

    @Test fun `direct window 14_00 active`() {
        // 2026-05-06 — среда
        assertTrue(ScheduleEvaluator.isActiveAt(direct, tzMoment("2026-05-06T14:00:00", tzMsk), tzMsk))
    }

    @Test fun `direct window 07_59 inactive (before)`() {
        assertFalse(ScheduleEvaluator.isActiveAt(direct, tzMoment("2026-05-06T07:59:00", tzMsk), tzMsk))
    }

    @Test fun `direct window 08_00 active (start inclusive)`() {
        assertTrue(ScheduleEvaluator.isActiveAt(direct, tzMoment("2026-05-06T08:00:00", tzMsk), tzMsk))
    }

    @Test fun `direct window 22_00 inactive (end exclusive)`() {
        assertFalse(ScheduleEvaluator.isActiveAt(direct, tzMoment("2026-05-06T22:00:00", tzMsk), tzMsk))
    }

    @Test fun `direct window 21_59 active`() {
        assertTrue(ScheduleEvaluator.isActiveAt(direct, tzMoment("2026-05-06T21:59:00", tzMsk), tzMsk))
    }

    // ─── cross-midnight 22-08 weekdays ──────────────────────────────────────

    private val cross = sched(daysMask = maskWeekdays, startMin = 1320, endMin = 480)

    @Test fun `cross monday 22_00 active (head today)`() {
        // 2026-05-04 = понедельник
        assertTrue(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-04T22:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross monday 21_59 inactive (before)`() {
        assertFalse(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-04T21:59:00", tzMsk), tzMsk))
    }

    @Test fun `cross tuesday 03_00 active (tail from monday)`() {
        // 2026-05-05 = вторник
        assertTrue(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-05T03:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross tuesday 07_59 active (tail from monday)`() {
        assertTrue(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-05T07:59:00", tzMsk), tzMsk))
    }

    @Test fun `cross tuesday 08_00 inactive (end exclusive)`() {
        assertFalse(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-05T08:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross saturday 03_00 active (tail from friday)`() {
        // 2026-05-09 = суббота, СБ нет в WEEKDAYS, но ПТ есть → tail
        assertTrue(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-09T03:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross saturday 22_00 inactive (head, SAT not in mask)`() {
        assertFalse(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-09T22:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross sunday 03_00 inactive (tail from sat, sat not in mask)`() {
        // 2026-05-10 = воскресенье, СБ не в маске
        assertFalse(ScheduleEvaluator.isActiveAt(cross, tzMoment("2026-05-10T03:00:00", tzMsk), tzMsk))
    }

    // ─── weekday-маска ──────────────────────────────────────────────────────

    private val wedOnly = sched(daysMask = maskWed, startMin = 0, endMin = 1440 - 1)

    @Test fun `wed mask wednesday 12_00 active`() {
        assertTrue(ScheduleEvaluator.isActiveAt(wedOnly, tzMoment("2026-05-06T12:00:00", tzMsk), tzMsk))
    }

    @Test fun `wed mask thursday 12_00 inactive`() {
        assertFalse(ScheduleEvaluator.isActiveAt(wedOnly, tzMoment("2026-05-07T12:00:00", tzMsk), tzMsk))
    }

    // ─── TZ-семантика ───────────────────────────────────────────────────────

    @Test fun `tz different result moscow vs vladivostok`() {
        val s = sched(daysMask = maskAll, startMin = 13 * 60, endMin = 14 * 60)
        // Момент когда в Москве 13:30, во Владивостоке 20:30 (UTC+10).
        val moment = tzMoment("2026-05-06T13:30:00", "Europe/Moscow")
        assertTrue(ScheduleEvaluator.isActiveAt(s, moment, "Europe/Moscow"))
        assertFalse(ScheduleEvaluator.isActiveAt(s, moment, "Asia/Vladivostok"))
    }

    @Test fun `tz half-hour offset kolkata weekday`() {
        // 2026-05-06 23:30 в Asia/Kolkata = среда. Окно 23:00-23:59 (среда), MASK_WED.
        val s = sched(daysMask = maskWed, startMin = 23 * 60, endMin = 23 * 60 + 59)
        val moment = tzMoment("2026-05-06T23:30:00", "Asia/Kolkata")
        assertTrue(ScheduleEvaluator.isActiveAt(s, moment, "Asia/Kolkata"))
    }

    // ─── cross-midnight + weekend mask ──────────────────────────────────────

    private val crossWeekend = sched(daysMask = maskWeekend, startMin = 23 * 60, endMin = 6 * 60)

    @Test fun `cross weekend saturday 23_30 active (head, sat in mask)`() {
        assertTrue(ScheduleEvaluator.isActiveAt(crossWeekend, tzMoment("2026-05-09T23:30:00", tzMsk), tzMsk))
    }

    @Test fun `cross weekend sunday 02_00 active (tail from sat, sat in mask)`() {
        assertTrue(ScheduleEvaluator.isActiveAt(crossWeekend, tzMoment("2026-05-10T02:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross weekend sunday 23_30 active (head, sun in mask)`() {
        assertTrue(ScheduleEvaluator.isActiveAt(crossWeekend, tzMoment("2026-05-10T23:30:00", tzMsk), tzMsk))
    }

    @Test fun `cross weekend monday 02_00 active (tail from sun, sun in mask)`() {
        // ПН не в маске, но это tail с воскресенья — активно.
        assertTrue(ScheduleEvaluator.isActiveAt(crossWeekend, tzMoment("2026-05-11T02:00:00", tzMsk), tzMsk))
    }

    @Test fun `cross weekend friday 23_30 inactive (head, fri not in weekend)`() {
        // 2026-05-08 = пятница
        assertFalse(ScheduleEvaluator.isActiveAt(crossWeekend, tzMoment("2026-05-08T23:30:00", tzMsk), tzMsk))
    }

    // ─── граница полуночи ───────────────────────────────────────────────────

    private val nearMidnight = sched(daysMask = maskMon, startMin = 23 * 60 + 55, endMin = 5)

    @Test fun `midnight monday 23_55 active`() {
        // 2026-05-04 = понедельник
        assertTrue(ScheduleEvaluator.isActiveAt(nearMidnight, tzMoment("2026-05-04T23:55:00", tzMsk), tzMsk))
    }

    @Test fun `midnight monday 23_54 inactive`() {
        assertFalse(ScheduleEvaluator.isActiveAt(nearMidnight, tzMoment("2026-05-04T23:54:00", tzMsk), tzMsk))
    }

    @Test fun `midnight tuesday 00_04 active (tail from mon, mon in mask)`() {
        assertTrue(ScheduleEvaluator.isActiveAt(nearMidnight, tzMoment("2026-05-05T00:04:00", tzMsk), tzMsk))
    }

    @Test fun `midnight tuesday 00_05 inactive (end exclusive)`() {
        assertFalse(ScheduleEvaluator.isActiveAt(nearMidnight, tzMoment("2026-05-05T00:05:00", tzMsk), tzMsk))
    }

    // ─── windowEndMs корректно вычисляет момент окончания окна ──────────────

    @Test fun `windowEndMs direct window — same day endMin`() {
        val s = direct
        val now = tzMoment("2026-05-06T14:00:00", tzMsk)
        val end = ScheduleEvaluator.windowEndMs(s, now, tzMsk)
        // 22:00 в Europe/Moscow того же дня
        val expected = tzMoment("2026-05-06T22:00:00", tzMsk)
        assertEquals(expected, end)
    }

    @Test fun `windowEndMs cross head — endMin tomorrow`() {
        // ПН 23:00 → cross-midnight, head from monday
        val s = cross
        val now = tzMoment("2026-05-04T23:00:00", tzMsk)
        val end = ScheduleEvaluator.windowEndMs(s, now, tzMsk)
        // 08:00 ВТ
        val expected = tzMoment("2026-05-05T08:00:00", tzMsk)
        assertEquals(expected, end)
    }

    @Test fun `windowEndMs cross tail — endMin today`() {
        // ВТ 03:00 → cross-midnight, tail from monday
        val s = cross
        val now = tzMoment("2026-05-05T03:00:00", tzMsk)
        val end = ScheduleEvaluator.windowEndMs(s, now, tzMsk)
        // 08:00 того же дня
        val expected = tzMoment("2026-05-05T08:00:00", tzMsk)
        assertEquals(expected, end)
    }

    // ─── формат minutes → "HH:MM" ───────────────────────────────────────────

    @Test fun `formatMinutes basic`() {
        assertEquals("00:00", ScheduleEvaluator.formatMinutes(0))
        assertEquals("08:00", ScheduleEvaluator.formatMinutes(480))
        assertEquals("22:00", ScheduleEvaluator.formatMinutes(1320))
        assertEquals("23:59", ScheduleEvaluator.formatMinutes(1439))
    }
}
