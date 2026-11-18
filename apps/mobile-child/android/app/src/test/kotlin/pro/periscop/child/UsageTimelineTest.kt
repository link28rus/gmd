package pro.periscop.child

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class UsageTimelineTest {
    private val start = Instant.parse("2026-11-17T23:00:00Z").toEpochMilli()
    private fun e(seconds: Long, type: Int, pkg: String = "app", activity: String = "A") =
        UsageTimeline.Event(start + seconds * 1000, type, pkg, activity)
    private fun seconds(events: List<UsageTimeline.Event>, from: Long = start, to: Long = start + 600_000) =
        UsageTimeline.calculate(events, from, to, ZoneId.of("UTC"), "own").sumOf { it.seconds }

    @Test fun `смена activity того же приложения не теряет предыдущий интервал`() {
        assertEquals(120, seconds(listOf(e(0, 1), e(60, 1, activity="B"), e(61, 23), e(120, 2, activity="B"))))
    }
    @Test fun `экран выключен и заблокирован - время не считается`() {
        assertEquals(120, seconds(listOf(e(0, 1), e(60, 16), e(120, 17), e(180, 15), e(240, 18), e(300, 2))))
    }
    @Test fun `shutdown закрывает приложение без явного pause`() {
        assertEquals(60, seconds(listOf(e(0, 1), e(60, 26))))
    }
    @Test fun `интервал начатый до границы запроса обрезается по границе`() {
        assertEquals(60, seconds(listOf(e(-60, 1), e(60, 2))))
    }
    @Test fun `одновременно учитывается только последнее foreground приложение`() {
        assertEquals(120, seconds(listOf(e(0, 1), e(60, 1, "other"), e(90, 2), e(120, 2, "other"))))
    }
    @Test fun `наш интерфейс и системный launcher не добавляются в отчёт`() {
        val rows = UsageTimeline.calculate(listOf(e(0, 1), e(60, 1, "own"), e(120, 1, "home")), start, start+180_000, ZoneId.of("UTC"), "own", setOf("home"))
        assertEquals(60, rows.sumOf { it.seconds })
    }
    @Test fun `полночь и часы разделяются по часовому поясу ребёнка`() {
        val rows = UsageTimeline.calculate(listOf(e(0, 1), e(7200, 2)), start, start+7200_000, ZoneId.of("UTC"), "own")
        assertEquals(listOf("2026-11-17", "2026-11-18"), rows.map { it.date })
        assertEquals(listOf(23, 0), rows.map { it.hour })
        assertEquals(listOf(3600, 3600), rows.map { it.seconds })
    }
    @Test fun `субсекундные интервалы складываются до округления`() {
        val events = listOf(UsageTimeline.Event(start,1,"app","A"), UsageTimeline.Event(start+600,2,"app","A"), UsageTimeline.Event(start+700,1,"app","A"), UsageTimeline.Event(start+1300,2,"app","A"))
        assertEquals(1, seconds(events))
    }
}
