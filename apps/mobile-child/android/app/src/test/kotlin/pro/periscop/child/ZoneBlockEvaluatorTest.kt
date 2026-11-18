package pro.periscop.child

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pro.periscop.child.ZoneBlockEvaluator.Fix
import pro.periscop.child.ZoneBlockEvaluator.Zone

class ZoneBlockEvaluatorTest {
    private val school = Zone("school", "Школа", 0.0, 0.0, 150)
    private val evaluator = ZoneBlockEvaluator().apply { replaceZones(listOf(school)) }

    private fun fix(at: Long, lat: Double = 0.0, accuracy: Double = 10.0) =
        Fix(lat, 0.0, accuracy, at)

    @Test
    fun confirmsEntryAndExitWithoutFlickeringAtBoundary() {
        evaluator.observe(fix(1_000), 1_000)
        assertNull(evaluator.activeZone(1_000))
        evaluator.observe(fix(31_000), 31_000)
        assertEquals(school, evaluator.activeZone(31_000))
        evaluator.observe(fix(40_000, lat = 0.0014), 40_000)
        assertEquals(school, evaluator.activeZone(40_000))
        evaluator.observe(fix(50_000, lat = 0.003), 50_000)
        assertEquals(school, evaluator.activeZone(50_000))
        evaluator.observe(fix(80_000, lat = 0.003), 80_000)
        assertNull(evaluator.activeZone(80_000))
    }

    @Test
    fun staleDuplicateAndInaccurateFixesDoNotActivateOrExtendABlock() {
        evaluator.observe(fix(1_000), 1_000)
        evaluator.observe(fix(1_000), 31_000)
        evaluator.observe(fix(31_000, accuracy = 800.0), 31_000)
        evaluator.observe(fix(32_000), 500_000)
        assertNull(evaluator.activeZone(500_000))
        evaluator.observe(fix(501_000), 501_000)
        evaluator.observe(fix(531_000), 531_000)
        assertEquals(school, evaluator.activeZone(531_000))
        evaluator.observe(fix(531_000), 620_000)
        assertNull(evaluator.activeZone(1_131_001))
    }

    @Test
    fun overlappingZonesAndEditsKeepOnlyApplicableBlocks() {
        val other = school.copy(id = "club", name = "Секция")
        evaluator.replaceZones(listOf(school, other))
        evaluator.observe(fix(1_000), 1_000)
        evaluator.observe(fix(31_000), 31_000)
        evaluator.replaceZones(listOf(other))
        assertEquals(other, evaluator.activeZone(31_000))
        val renamed = other.copy(name = "Кружок")
        evaluator.replaceZones(listOf(renamed))
        assertEquals(renamed, evaluator.activeZone(31_000))
        evaluator.replaceZones(listOf(renamed.copy(radius = 200)))
        assertNull(evaluator.activeZone(31_000))
    }

    @Test
    fun requestsFixWhenStationaryProviderStopsSendingLocations() {
        assertTrue(evaluator.needsFix(0))
        evaluator.observe(fix(1_000), 1_000)
        assertFalse(evaluator.needsFix(30_000))
        assertTrue(evaluator.needsFix(31_000))
        evaluator.observe(fix(31_000), 31_000)
        assertFalse(evaluator.needsFix(100_000))
        assertTrue(evaluator.needsFix(271_000))
        evaluator.replaceZones(emptyList())
        assertFalse(evaluator.needsFix(271_000))
    }

    @Test
    fun passingThroughBeforeConfirmationDoesNotActivateBlock() {
        evaluator.observe(fix(1_000), 1_000)
        evaluator.observe(fix(15_000, lat = 0.003), 15_000)
        evaluator.observe(fix(31_000), 31_000)
        assertNull(evaluator.activeZone(31_000))
    }

    @Test
    fun restoresConfirmedPresenceAfterProcessRestartWithoutExtendingItsLifetime() {
        evaluator.observe(fix(1_000), 1_000)
        evaluator.observe(fix(31_000), 31_000)
        val checkpoint = evaluator.confirmedPresence(32_000)
        val restarted = ZoneBlockEvaluator().apply {
            replaceZones(listOf(school))
            restorePresence(checkpoint, 32_000)
        }
        assertEquals(school, restarted.activeZone(32_000))
        restarted.observe(fix(30_000, lat = 0.003), 32_000)
        assertEquals(school, restarted.activeZone(630_999))
        assertNull(restarted.activeZone(631_000))
        assertEquals(emptyMap<String, Long>(), evaluator.confirmedPresence(
            32_000, listOf(school.copy(radius = 200)),
        ))
    }
}
