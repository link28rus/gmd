package pro.periscop.parent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import pro.periscop.parent.ParentMotionPolicy.Profile

class ParentMotionPolicyTest {

    private val min = 60_000L
    private val now = 100 * min

    @Test
    fun `speed above 2 in STILL switches to ACTIVE`() {
        val d = ParentMotionPolicy.onLocation(Profile.STILL, true, 9.0f, now, 0L)
        assertEquals(Profile.ACTIVE, d.profile)
        assertNotNull(d.reason)
        assertEquals(now, d.lastMovingAtMs)
    }

    @Test
    fun `speed above 2 in ACTIVE stays and refreshes last movement`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, true, 9.0f, now, now - 10 * min)
        assertEquals(Profile.ACTIVE, d.profile)
        assertNull(d.reason)
        assertEquals(now, d.lastMovingAtMs)
    }

    @Test
    fun `traffic light 2 min in ACTIVE stays ACTIVE`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, true, 0f, now, now - 2 * min)
        assertEquals(Profile.ACTIVE, d.profile)
        assertNull(d.reason)
    }

    @Test
    fun `16 min without movement in ACTIVE switches to STILL`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, true, 0.2f, now, now - 16 * min)
        assertEquals(Profile.STILL, d.profile)
        assertNotNull(d.reason)
    }

    @Test
    fun `16 min without movement and point without speed switches to STILL`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, false, 0f, now, now - 16 * min)
        assertEquals(Profile.STILL, d.profile)
    }

    @Test
    fun `exactly 15 min without movement stays ACTIVE (strict boundary)`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, true, 0f, now, now - 15 * min)
        assertEquals(Profile.ACTIVE, d.profile)
    }

    @Test
    fun `walking speed after debounce stays ACTIVE`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, true, 1.2f, now, now - 20 * min)
        assertEquals(Profile.ACTIVE, d.profile)
        assertEquals(now - 20 * min, d.lastMovingAtMs)
    }

    @Test
    fun `no movement ever recorded keeps ACTIVE`() {
        val d = ParentMotionPolicy.onLocation(Profile.ACTIVE, true, 0f, now, 0L)
        assertEquals(Profile.ACTIVE, d.profile)
    }

    @Test
    fun `slow point in STILL stays STILL`() {
        val d = ParentMotionPolicy.onLocation(Profile.STILL, true, 1.5f, now, 0L)
        assertEquals(Profile.STILL, d.profile)
        assertNull(d.reason)
    }

    @Test
    fun `AR STILL with recent movement under 3 min is deferred`() {
        val d = ParentMotionPolicy.onArStill(Profile.ACTIVE, now, now - 1 * min)
        assertEquals(Profile.ACTIVE, d.profile)
        assertNull(d.reason)
        assertEquals(2 * min, d.recheckInMs)
    }

    @Test
    fun `AR STILL after 3 min without movement switches to STILL`() {
        val d = ParentMotionPolicy.onArStill(Profile.ACTIVE, now, now - 3 * min)
        assertEquals(Profile.STILL, d.profile)
        assertNotNull(d.reason)
        assertEquals(0L, d.recheckInMs)
    }

    @Test
    fun `AR STILL with no movement ever switches to STILL`() {
        val d = ParentMotionPolicy.onArStill(Profile.ACTIVE, now, 0L)
        assertEquals(Profile.STILL, d.profile)
    }

    @Test
    fun `AR STILL in STILL is a no-op`() {
        val d = ParentMotionPolicy.onArStill(Profile.STILL, now, 0L)
        assertEquals(Profile.STILL, d.profile)
        assertNull(d.reason)
        assertEquals(0L, d.recheckInMs)
    }

    @Test
    fun `AR MOVING in STILL switches to ACTIVE`() {
        val d = ParentMotionPolicy.onMoving(Profile.STILL, now, "AR: движение")
        assertEquals(Profile.ACTIVE, d.profile)
        assertEquals("AR: движение", d.reason)
        assertEquals(now, d.lastMovingAtMs)
    }

    @Test
    fun `AR MOVING in ACTIVE refreshes last movement only`() {
        val d = ParentMotionPolicy.onMoving(Profile.ACTIVE, now, "AR: движение")
        assertEquals(Profile.ACTIVE, d.profile)
        assertNull(d.reason)
        assertEquals(now, d.lastMovingAtMs)
    }

    @Test
    fun `escape single far jump stays STILL with one hit`() {
        val d = ParentMotionPolicy.onStillPoint(Profile.STILL, 500.0, 30f, 0, now, 0L)
        assertEquals(Profile.STILL, d.profile)
        assertNull(d.reason)
        assertEquals(1, d.escapeHits)
    }

    @Test
    fun `escape two far points in a row switches to ACTIVE`() {
        val first = ParentMotionPolicy.onStillPoint(Profile.STILL, 500.0, 30f, 0, now, 0L)
        val second = ParentMotionPolicy.onStillPoint(
            first.profile, 700.0, 40f, first.escapeHits, now + min, first.lastMovingAtMs,
        )
        assertEquals(Profile.ACTIVE, second.profile)
        assertNotNull(second.reason)
        assertEquals(now + min, second.lastMovingAtMs)
        assertEquals(0, second.escapeHits)
    }

    @Test
    fun `escape far jump then near point resets counter`() {
        val first = ParentMotionPolicy.onStillPoint(Profile.STILL, 500.0, 30f, 0, now, 0L)
        val second = ParentMotionPolicy.onStillPoint(
            Profile.STILL, 50.0, 30f, first.escapeHits, now + min, 0L,
        )
        assertEquals(Profile.STILL, second.profile)
        assertEquals(0, second.escapeHits)
    }

    @Test
    fun `coarse point within 2x accuracy is not escape`() {
        val d = ParentMotionPolicy.onStillPoint(Profile.STILL, 300.0, 200f, 1, now, 0L)
        assertEquals(Profile.STILL, d.profile)
        assertEquals(0, d.escapeHits)
    }

    @Test
    fun `point within 200 m minimum is not escape even with good accuracy`() {
        val d = ParentMotionPolicy.onStillPoint(Profile.STILL, 180.0, 10f, 1, now, 0L)
        assertEquals(Profile.STILL, d.profile)
        assertEquals(0, d.escapeHits)
    }

    @Test
    fun `point without accuracy uses 50 m default`() {
        val d = ParentMotionPolicy.onStillPoint(Profile.STILL, 250.0, null, 0, now, 0L)
        assertEquals(1, d.escapeHits)
    }

    @Test
    fun `escape check in ACTIVE is a no-op`() {
        val d = ParentMotionPolicy.onStillPoint(Profile.ACTIVE, 5000.0, 10f, 1, now, now)
        assertEquals(Profile.ACTIVE, d.profile)
        assertNull(d.reason)
        assertEquals(0, d.escapeHits)
    }
}
