package pro.periscop.child

import org.junit.Assert.*
import org.junit.Test
import java.time.ZoneId

class UsagePeriodsTest {
    @Test fun `TIME_SET между snapshot и merge отменяет результат старой эпохи`() {
        val snapshot=UsagePeriods.Snapshot(86400_000,1000,1,listOf(UsagePeriods.Period(0,"UTC")))
        assertFalse(UsagePeriods.clockMatches(snapshot,2,0,1001))
        // Broadcast может ещё ждать main thread: расхождение с monotonic тоже отменяет результат.
        assertFalse(UsagePeriods.clockMatches(snapshot,1,0,1001))
    }
    @Test fun `обычный долгий сбор без изменения часов остаётся действительным`() {
        val snapshot=UsagePeriods.Snapshot(86400_000,1000,1,listOf(UsagePeriods.Period(0,"UTC")))
        assertTrue(UsagePeriods.clockMatches(snapshot,1,86460_000,61_000))
    }
    @Test fun `исправление часов назад не замораживает сбор на сутки`() {
        val periods=UsagePeriods.advance(listOf(UsagePeriods.Period(86400_000,"UTC")),"UTC",0,0)
        assertEquals(0L,periods.single().start)
        assertNotEquals("86400000",periods.single().id)
    }
    @Test fun `TIME_SET вперёд также создаёт новую границу без повторного импорта`() {
        val previous=listOf(UsagePeriods.Period(0,"UTC"))
        val periods=UsagePeriods.restart(previous,"UTC",86400_000)
        assertEquals(86400_000L,periods.single().start)
        assertNotEquals(previous.single().id,periods.single().id)
    }
    @Test fun `смена пояса не удваивает один уже учтённый час`() {
        val periods=UsagePeriods.advance(listOf(UsagePeriods.Period(0,"Europe/Moscow")),"Asia/Vladivostok",3600_000,0)
        val events=listOf(UsageTimeline.Event(0,1,"game","A"))
        val total=periods.sumOf { p -> UsageTimeline.calculate(events,p.start,p.end ?: 3600_000,ZoneId.of(p.zone),"own").sumOf { it.seconds } }
        assertEquals(3600,total)
        assertEquals(3600_000L,periods.first().end)
    }
    @Test fun `новая привязка отсекает периоды прежнего ребёнка`() {
        val periods=UsagePeriods.advance(listOf(UsagePeriods.Period(0,"UTC")),"UTC",20_000,10_000)
        val events=listOf(UsageTimeline.Event(0,1,"game","A"))
        assertEquals(listOf(UsagePeriods.Period(10_000,"UTC")),periods)
        assertEquals(10,UsageTimeline.calculate(events,periods.single().start,20_000,ZoneId.of("UTC"),"own").sumOf { it.seconds })
    }
}
