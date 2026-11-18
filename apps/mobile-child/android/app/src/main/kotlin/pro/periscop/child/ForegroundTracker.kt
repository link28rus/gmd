package pro.periscop.child

import android.app.usage.UsageEvents.Event

/** Собственное окно блокировки и автоматический HOME не заменяют ограниченное приложение. */
class ForegroundTracker(private val own: String) {
    data class ActiveApp(val packageName: String, val resumedAt: Long)

    private var observedAt = Long.MIN_VALUE
    var packageName: String? = null
        private set

    fun observe(pkg: String, windowClass: String?, overlayVisible: Boolean, home: Boolean, observedAt: Long) {
        val ownActivity = windowClass == "$own.MainActivity" || windowClass == "$own.MicWakeActivity"
        if(overlayVisible && (home || (pkg == own && !ownActivity))) return
        packageName = pkg
        this.observedAt = observedAt
    }

    fun reconcile(app: ActiveApp?, sampledAt: Long) {
        if (app == null || observedAt >= sampledAt) return
        // Системное окно может заслонить окно приложения, не переводя его в фон.
        val systemWindow = packageName == "android" || packageName == "com.android.systemui"
        if (!systemWindow && app.resumedAt <= observedAt) return
        packageName = app.packageName
    }

    fun clear(at: Long) {
        packageName = null
        observedAt = at
    }

    /** Последняя активная Activity из системных событий, включая Android 8–9 (типы 1 и 2). */
    class UsageActivity {
        private var activity: String? = null
        var current: ActiveApp? = null
            private set

        fun record(type: Int, pkg: String?, windowClass: String?, at: Long) {
            when (type) {
                Event.ACTIVITY_RESUMED -> {
                    current = pkg?.let { ActiveApp(it, at) }
                    activity = windowClass
                }
                // onStop может прийти уже после onResume нового экземпляра того же класса.
                Event.ACTIVITY_PAUSED -> {
                    if (current?.packageName == pkg && (windowClass == null || activity == windowClass)) {
                        current = null
                        activity = null
                    }
                }
                Event.DEVICE_SHUTDOWN, Event.DEVICE_STARTUP -> {
                    current = null
                    activity = null
                }
            }
        }
    }
}
