package pro.periscop.parent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** v0.73.1: прореживание офлайн-буфера — место кражи (старые точки) не теряется. */
class ParentLocationBufferTest {
    private fun points(n: Int) = (0 until n).map { "p$it" }

    @Test
    fun `under cap unchanged`() {
        val p = points(10)
        assertEquals(p, ParentLocationBuffer.thin(p, 10))
    }

    @Test
    fun `over cap keeps first and last and fits`() {
        val p = points(101)
        val out = ParentLocationBuffer.thin(p, 100)
        assertTrue(out.size <= 100)
        assertEquals("p0", out.first())
        assertEquals("p100", out.last())
    }

    @Test
    fun `newer half kept intact on first pass`() {
        val p = points(120)
        val out = ParentLocationBuffer.thin(p, 100)
        // одна итерация: старшая половина 60 → 30, младшая 60 целиком
        assertEquals(90, out.size)
        assertEquals(p.subList(60, 120), out.takeLast(60))
    }

    @Test
    fun `order preserved`() {
        val out = ParentLocationBuffer.thin(points(1000), 100)
        val idx = out.map { it.removePrefix("p").toInt() }
        assertEquals(idx.sorted(), idx)
        assertEquals(0, idx.first())
    }

    @Test
    fun `oldest third still represented after heavy overflow`() {
        val out = ParentLocationBuffer.thin(points(30_000), 20_000)
        val idx = out.map { it.removePrefix("p").toInt() }
        assertTrue(out.size <= 20_000)
        assertTrue(idx.count { it < 10_000 } > 1_000)
    }
}
