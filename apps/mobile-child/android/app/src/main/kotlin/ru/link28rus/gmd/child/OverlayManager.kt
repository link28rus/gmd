package ru.link28rus.gmd.child

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView

/**
 * v0.39.5 Phase 6.2 — visual blocking overlay через WindowManager.addView.
 *
 * Раньше (v0.39.0..v0.39.4) использовался [BlockOverlayActivity] — full-screen
 * Activity, запускаемая `startActivity` из AccessibilityService. На Android 12+
 * (особенно HyperOS / MIUI) это блокируется системой:
 *
 *   E ActivityTaskManager: Abort background activity starts
 *
 * Это «Background Activity Start» (BAL) restriction — Activity нельзя стартовать
 * из background context (а наш a11y-процесс считается background).
 *
 * **Решение:** TYPE_APPLICATION_OVERLAY layer. Это **window**, не activity, и
 * требует только `SYSTEM_ALERT_WINDOW` permission (special access, грантится
 * руками через системные настройки). На этот layer BAL ограничения НЕ
 * распространяются.
 *
 * Использует тот же XML layout `activity_block_overlay.xml` — visually identical
 * к старому Activity (🔒 + countdown + «Закрыть»).
 *
 * Если SAW не grant'ed — [show] no-op'ает, AccessibilityService падает обратно
 * на `performGlobalAction(GLOBAL_ACTION_HOME)` (всегда работает, но без visual
 * объяснения почему app закрылся).
 *
 * **Singleton-paradigm:** state (view, endsAt, timer) хранится в object'е.
 * Концепционально это «один blocking screen на устройство в момент времени».
 * Все методы synchronized — onAccessibilityEvent + FCM handlers + tickRunnable
 * могут попасть в гонку.
 */
object OverlayManager {
    private const val TAG = "block_overlay"

    private var view: View? = null
    private var endsAtMs: Long = 0L
    private val handler = Handler(Looper.getMainLooper())

    private val tickRunnable = object : Runnable {
        override fun run() {
            val v = view ?: return
            val ctx = v.context.applicationContext
            val now = System.currentTimeMillis()

            // v0.49 Phase 6.x: пересчитываем combined endsAt каждый тик, потому
            // что активное расписание может «съехать» (одно окно закончилось,
            // другое не наступило), а BlockSession независимо может expire.
            val combinedEndsAt = BlockManager.getCurrentBlockEndsAtMs(ctx)
            val activeBlock = BlockManager.getActiveBlock(ctx)
            val activeSchedule = BlockManager.getActiveSchedule(ctx)

            if (combinedEndsAt <= 0L) {
                // Никакой активной блокировки — снимаем overlay.
                // BlockSession.expire авто-чистится в getActiveBlock.
                hide(ctx, "tick-no-active")
                return
            }

            val remainingMs = combinedEndsAt - now
            if (remainingMs <= 0L) {
                // Текущее окно закончилось. Если активная сессия — её auto-cleanup
                // в getActiveBlock уже сработал. Если расписание — окно естественно
                // закончилось, новый tick (через 1с) пересчитает.
                if (activeBlock != null && activeBlock.endsAtMs <= now && activeSchedule == null) {
                    BlockManager.clearActiveBlock(ctx, "overlay-tick-expired")
                }
                hide(ctx, "tick-expired")
                return
            }

            endsAtMs = combinedEndsAt
            v.findViewById<TextView>(R.id.block_overlay_remaining)?.text =
                formatRemaining(remainingMs)
            handler.postDelayed(this, 1000L)
        }
    }

    /**
     * Можно ли показать overlay? Проверка `Settings.canDrawOverlays`
     * (= `SYSTEM_ALERT_WINDOW` permission grant'ed).
     */
    fun canShow(ctx: Context): Boolean = Settings.canDrawOverlays(ctx.applicationContext)

    /**
     * Показать blocking overlay. Если уже показан — обновляем endsAt и продолжаем.
     * Если SAW не grant'ed — silent no-op (caller должен fallback'нуться на HOME).
     */
    @Synchronized
    fun show(ctx: Context, endsAtMsParam: Long) {
        val appCtx = ctx.applicationContext
        if (!Settings.canDrawOverlays(appCtx)) {
            DiagLog.write(appCtx, TAG, "show: SYSTEM_ALERT_WINDOW not granted, no-op")
            return
        }
        endsAtMs = endsAtMsParam
        if (view != null) {
            // Уже показан — просто рестартуем тикер с новым endsAt.
            handler.removeCallbacks(tickRunnable)
            handler.post(tickRunnable)
            return
        }
        try {
            val inflater = LayoutInflater.from(appCtx)
            // null parent — overlay инфлэйтим в WindowManager, не в Activity.
            val v = inflater.inflate(R.layout.activity_block_overlay, null)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                else {
                    @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
                },
                // FLAG_NOT_FOCUSABLE убрал — иначе click на «Закрыть» не сработает.
                // FLAG_LAYOUT_IN_SCREEN — overlay покрывает statusbar.
                // FLAG_KEEP_SCREEN_ON — пока ребёнок смотрит таймер, экран не гасится.
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.OPAQUE,
            )

            v.findViewById<Button>(R.id.block_overlay_home).setOnClickListener {
                DiagLog.write(appCtx, TAG, "close button tapped → hide + home")
                hide(appCtx, "user-close")
                goHome(appCtx)
            }

            val wm = appCtx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm.addView(v, params)
            view = v
            handler.post(tickRunnable)
            DiagLog.write(appCtx, TAG, "overlay shown via WindowManager endsAt=$endsAtMs")
        } catch (e: Throwable) {
            DiagLog.write(appCtx, TAG, "addView FAILED: ${e.javaClass.simpleName}: ${e.message}")
            view = null
        }
    }

    /** Убрать overlay (idempotent). */
    @Synchronized
    fun hide(ctx: Context, reason: String = "manual") {
        val v = view ?: return
        handler.removeCallbacks(tickRunnable)
        try {
            val wm = ctx.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm.removeView(v)
        } catch (_: Throwable) {
            // View могла быть уже удалена при resource cleanup'е — игнорируем.
        }
        view = null
        DiagLog.write(ctx.applicationContext, TAG, "overlay hidden reason=$reason")
    }

    fun isShowing(): Boolean = view != null

    /**
     * Послать ACTION_MAIN+CATEGORY_HOME — ребёнок попадает на launcher.
     * HOME-intent имеет специальный exemption от BAL, работает из background.
     */
    private fun goHome(ctx: Context) {
        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        try {
            ctx.applicationContext.startActivity(home)
        } catch (e: Throwable) {
            DiagLog.write(
                ctx.applicationContext,
                TAG,
                "goHome failed: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }

    private fun formatRemaining(ms: Long): String {
        if (ms <= 0L) return "ещё 0 сек"
        val totalSec = (ms / 1000L).toInt()
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return when {
            h > 0 -> "ещё $h ч $m мин"
            m > 0 -> "ещё $m мин ${s.toString().padStart(2, '0')} сек"
            else -> "ещё $s сек"
        }
    }
}
