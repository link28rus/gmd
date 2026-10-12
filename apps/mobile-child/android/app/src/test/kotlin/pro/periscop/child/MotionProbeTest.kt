package pro.periscop.child

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionProbeTest {
    private val trigger = 1_000_000L

    @Test
    fun `arm delay grows after idle probes and caps at five minutes`() {
        assertEquals(60_000L, MotionProbe.armDelayMs(0))
        assertEquals(120_000L, MotionProbe.armDelayMs(1))
        assertEquals(240_000L, MotionProbe.armDelayMs(2))
        assertEquals(300_000L, MotionProbe.armDelayMs(3))
        assertEquals(300_000L, MotionProbe.armDelayMs(10))
        assertEquals(60_000L, MotionProbe.armDelayMs(-1))
    }

    @Test
    fun `phone picked up but not carried anywhere is not movement`() {
        assertFalse(MotionProbe.isRealMovement(trigger, trigger - 5_000, 12.0, 8f))
    }

    @Test
    fun `speed or activity recognition after trigger is movement`() {
        assertTrue(MotionProbe.isRealMovement(trigger, trigger + 30_000, 0.0, 5f))
    }

    @Test
    fun `walking away more than fifty meters is movement`() {
        assertTrue(MotionProbe.isRealMovement(trigger, 0L, 180.0, 6f))
    }

    @Test
    fun `displacement within twice the accuracy is gps jitter`() {
        assertFalse(MotionProbe.isRealMovement(trigger, 0L, 90.0, 60f))
        assertTrue(MotionProbe.isRealMovement(trigger, 0L, 130.0, 60f))
    }

    @Test
    fun `no anchor point keeps active to protect the track`() {
        assertTrue(MotionProbe.isRealMovement(trigger, 0L, null, null))
    }
}
