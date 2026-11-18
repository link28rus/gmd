package pro.periscop.child

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent

/** Получает только packageName, без доступа к содержимому окон. */
class PeriscopAccessibilityService: AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val foreground by lazy { ForegroundTracker(packageName) }
    private val tick = object: Runnable {
        override fun run() {
            try { checkForeground() } catch(e: Exception) {
                OverlayManager.hide(this@PeriscopAccessibilityService)
                DiagLog.write(this@PeriscopAccessibilityService,"app_control","foreground check failed: ${e.javaClass.simpleName}")
            }
            if ((getSystemService(POWER_SERVICE) as PowerManager).isInteractive) handler.postDelayed(this,1000)
        }
    }
    private val receiver = object: BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if(intent?.action == Intent.ACTION_SCREEN_OFF) OverlayManager.hide(this@PeriscopAccessibilityService)
            refresh()
        }
    }
    override fun onServiceConnected() {
        super.onServiceConnected()
        current = this
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_TIME_CHANGED); addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }
        if(Build.VERSION.SDK_INT >= 33) registerReceiver(receiver,filter,RECEIVER_NOT_EXPORTED) else registerReceiver(receiver,filter)
        AppControlScheduler.syncNow(this)
        AppControlScheduler.runInstalledAppsNow(this)
        refresh()
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if(event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        val home = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),0).any { it.activityInfo.packageName == pkg }
        foreground.observe(pkg,event.className?.toString(),OverlayManager.isShowing(),home)
        refresh()
    }
    private fun checkForeground() {
        val pkg = foreground.packageName
        if (pkg == null || NativeCreds.getToken(this).isNullOrEmpty() || NativeCreds.isUnlinked(this) ||
            !(getSystemService(POWER_SERVICE) as PowerManager).isInteractive ||
            (getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager).isKeyguardLocked || !BlockManager.isBlocked(this,pkg)) {
            OverlayManager.hide(this)
            return
        }
        if(!OverlayManager.show(this,pkg)) performGlobalAction(GLOBAL_ACTION_HOME)
    }
    fun dismissBlock() { foreground.clear(); OverlayManager.hide(this) }
    fun dismissToHome() { dismissBlock(); performGlobalAction(GLOBAL_ACTION_HOME) }
    override fun onInterrupt() { OverlayManager.hide(this) }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { unregisterReceiver(receiver) } catch (_: IllegalArgumentException) { }
        OverlayManager.hide(this)
        if(current === this) current = null
        AppControlScheduler.reportPermissionsNow(this)
        AppControlScheduler.syncNow(this)
        super.onDestroy()
    }
    companion object {
        @Volatile private var current: PeriscopAccessibilityService? = null
        fun isConnected() = current != null
        fun refresh() { current?.let { service -> service.handler.removeCallbacks(service.tick); service.handler.post(service.tick) } }
    }
}
