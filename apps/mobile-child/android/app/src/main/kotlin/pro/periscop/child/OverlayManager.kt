package pro.periscop.child

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.view.WindowManager

/** Окно живёт только в подключённой AccessibilityService; отдельная Activity не нужна. */
object OverlayManager {
    private var view: BlockOverlayView? = null
    fun isShowing() = view != null
    internal fun show(service: PeriscopAccessibilityService, screen: BlockScreen): Boolean {
        val now = BlockManager.now(service)
        view?.let {
            it.render(screen, now)
            return true
        }
        return try {
            // Приложение уходит в background: экран отдыха не начисляется игре.
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            val box = BlockOverlayView(service, onHome = service::dismissToHome, onCall = {
                service.dismissBlock()
                try { service.startActivity(Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { service.dismissToHome() }
            }).apply { render(screen, now) }
            val params = WindowManager.LayoutParams(
                -1, -1, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.OPAQUE,
            )
            (service.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(box,params)
            view = box
            true
        } catch(e: Exception) {
            DiagLog.write(service,"app_control","overlay unavailable: ${e.javaClass.simpleName}")
            false
        }
    }
    fun hide(ctx: Context, reason: String = "refresh") {
        val previous = view ?: return
        // SharedPreferences/HTTP callers используют main handler через refresh; escape тоже может прийти из worker.
        if(android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            android.os.Handler(android.os.Looper.getMainLooper()).post { hide(ctx,reason) }; return
        }
        try { (previous.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(previous) } catch (_: Exception) { }
        view = null
    }
}
