package pro.periscop.child

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Color
import android.view.WindowManager
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button

/** Окно живёт только в подключённой AccessibilityService; отдельная Activity не нужна. */
object OverlayManager {
    private var view: View? = null
    private var label: TextView? = null
    fun isShowing() = view != null
    fun show(service: PeriscopAccessibilityService, pkg: String): Boolean {
        val until = BlockManager.getCurrentBlockEndsAtMs(service)
        val remaining = ((until-BlockManager.now(service)).coerceAtLeast(0)+59_999)/60_000
        val zone = BlockManager.getBlockingZoneName(service, pkg)
        val text = when {
            zone != null -> "Приложение ограничено в зоне «$zone»"
            until > 0 -> "Сейчас время отдыха\nОсталось $remaining мин"
            else -> "Это приложение ограничено родителем"
        }
        label?.text = text
        if(view != null) return true
        return try {
            // Приложение уходит в background: экран отдыха не начисляется игре.
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            val box = LinearLayout(service).apply {
                orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER
                setPadding(48,48,48,48); setBackgroundColor(Color.rgb(245,247,252))
            }
            val title = TextView(service).apply { this.text = text; textSize = 25f; gravity = android.view.Gravity.CENTER; setTextColor(Color.rgb(25,35,55)) }
            box.addView(title)
            box.addView(Button(service).apply { this.text="На главный экран"; setOnClickListener { service.dismissToHome() } })
            box.addView(Button(service).apply { this.text="Позвонить"; setOnClickListener {
                service.dismissBlock()
                try { service.startActivity(Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { service.dismissToHome() }
            } })
            val params = WindowManager.LayoutParams(-1,-1,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.OPAQUE)
            (service.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(box,params)
            view=box; label=title
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
        view=null; label=null
    }
}
