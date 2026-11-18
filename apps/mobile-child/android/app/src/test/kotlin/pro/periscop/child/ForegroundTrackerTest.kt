package pro.periscop.child

import android.app.usage.UsageEvents.Event
import org.junit.Assert.*
import org.junit.Test

class ForegroundTrackerTest {
    @Test fun `MainActivity всегда заменяет прошлую игру даже при открытом overlay`() {
        val state=ForegroundTracker("own")
        state.observe("game", "Game", false, false, observedAt = 100)
        state.observe("own", "own.MainActivity", true, false, observedAt = 200)
        assertEquals("own",state.packageName)
    }
    @Test fun `окно overlay и автоматический HOME не теряют причину блокировки`() {
        val state=ForegroundTracker("own")
        state.observe("game", "Game", false, false, observedAt = 100)
        state.observe("own", "android.widget.LinearLayout", true, false, observedAt = 200)
        state.observe("home", "Home", true, true, observedAt = 300)
        assertEquals("game",state.packageName)
        state.clear(at = 400)
        assertNull(state.packageName)
    }

    @Test fun `синхронизация находит уже открытый YouTube без события доступности`() {
        val tracker = ForegroundTracker("own")
        val usage = ForegroundTracker.UsageActivity()
        usage.record(Event.ACTIVITY_RESUMED, YOUTUBE, "WatchActivity", 100)
        tracker.reconcile(usage.current, sampledAt = 200)
        assertEquals(YOUTUBE, tracker.packageName)
    }

    @Test fun `системное окно не скрывает приложение при синхронизации`() {
        val tracker = ForegroundTracker("own")
        tracker.observe("com.android.systemui", "SystemWindow", false, false, observedAt = 150)
        tracker.reconcile(ForegroundTracker.ActiveApp(YOUTUBE, 100), sampledAt = 200)
        assertEquals(YOUTUBE, tracker.packageName)
    }

    @Test fun `синхронизация не возвращает YouTube после переключения в разрешённое приложение`() {
        val tracker = ForegroundTracker("own")
        tracker.observe("own", "own.MainActivity", false, false, observedAt = 210)
        tracker.reconcile(ForegroundTracker.ActiveApp(YOUTUBE, 100), sampledAt = 200)
        assertEquals("own", tracker.packageName)
    }

    @Test fun `поздняя пауза другого окна не стирает текущее а пауза текущего его снимает`() {
        val usage = ForegroundTracker.UsageActivity()
        usage.record(Event.ACTIVITY_RESUMED, YOUTUBE, "First", 100)
        usage.record(Event.ACTIVITY_RESUMED, YOUTUBE, "Second", 110)
        usage.record(Event.ACTIVITY_PAUSED, YOUTUBE, "First", 120)
        assertEquals(ForegroundTracker.ActiveApp(YOUTUBE, 110), usage.current)
        usage.record(Event.ACTIVITY_PAUSED, YOUTUBE, "Second", 130)
        assertNull(usage.current)
    }

    @Test fun `после перезапуска устройства старое приложение не считается открытым`() {
        val usage = ForegroundTracker.UsageActivity()
        usage.record(Event.ACTIVITY_RESUMED, YOUTUBE, "WatchActivity", 100)
        usage.record(Event.DEVICE_STARTUP, "android", null, 200)
        assertNull(usage.current)
    }

    @Test fun `остановка старого экземпляра не стирает открытый экземпляр того же класса`() {
        val usage = ForegroundTracker.UsageActivity()
        usage.record(Event.ACTIVITY_RESUMED, YOUTUBE, "WatchActivity", 100)
        usage.record(Event.ACTIVITY_PAUSED, YOUTUBE, "WatchActivity", 110)
        usage.record(Event.ACTIVITY_RESUMED, YOUTUBE, "WatchActivity", 120)
        usage.record(Event.ACTIVITY_STOPPED, YOUTUBE, "WatchActivity", 130)
        assertEquals(ForegroundTracker.ActiveApp(YOUTUBE, 120), usage.current)
    }

    private companion object {
        const val YOUTUBE = "com.google.android.youtube"
    }
}
