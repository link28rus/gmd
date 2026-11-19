package pro.periscop.child

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BlockScreenTest {
    @Test fun `причина становится заголовком, таймер отсчитывает до конца паузы`() {
        val screen = BlockScreen.pause("Делаем уроки", 7_259_000)
        assertEquals("Делаем уроки", screen.title)
        assertEquals("02:00:59", screen.countdown(0))
        assertEquals("01:00", screen.countdown(7_199_001))
        assertEquals("00:01", screen.countdown(7_258_999))
        assertEquals("00:00", screen.countdown(7_260_000))
    }

    @Test fun `старая сессия получает заголовок по умолчанию, постоянное правило без таймера`() {
        assertEquals("Время отдыха", BlockScreen.pause(null, 3_000).title)
        assertEquals("Время отдыха", BlockScreen.pause("  ", 3_000).title)
        assertNull(BlockScreen("Приложение ограничено").countdown(0))
    }
}
