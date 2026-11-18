package pro.periscop.child

import org.junit.Assert.*
import org.junit.Test

class ForegroundTrackerTest {
    @Test fun `MainActivity всегда заменяет прошлую игру даже при открытом overlay`() {
        val state=ForegroundTracker("own")
        state.observe("game","Game",false,false)
        state.observe("own","own.MainActivity",true,false)
        assertEquals("own",state.packageName)
    }
    @Test fun `окно overlay и автоматический HOME не теряют причину блокировки`() {
        val state=ForegroundTracker("own")
        state.observe("game","Game",false,false)
        state.observe("own","android.widget.LinearLayout",true,false)
        state.observe("home","Home",true,true)
        assertEquals("game",state.packageName)
        state.clear()
        assertNull(state.packageName)
    }
}
