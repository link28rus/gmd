package ru.link28rus.gmd.child

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView

/**
 * v0.39 Phase 6.2 — full-screen блокировочный экран.
 *
 * Запускается AccessibilityService (TYPE_WINDOW_STATE_CHANGED) когда ребёнок
 * пытается открыть заблокированное приложение. Показывает таймер countdown и
 * кнопку «Закрыть» (Home).
 *
 * Особенности:
 *   - FLAG_SHOW_WHEN_LOCKED + setShowWhenLocked → работает даже на lockscreen
 *   - FLAG_KEEP_SCREEN_ON → не гасит экран пока ребёнок смотрит таймер
 *   - onBackPressed swallowed — back-button не закрывает overlay
 *   - onPause → finish() — если пользователь вышел через Home/swipe → activity
 *     убирается. AccessibilityService при следующей попытке открыть blocked app
 *     поднимет overlay снова.
 *   - excludeFromRecents=true — overlay не висит в recent apps.
 *
 * **Важно:** AccessibilityService вызывает startActivity с FLAG_ACTIVITY_NEW_TASK
 * + FLAG_ACTIVITY_CLEAR_TOP. Запускать BlockOverlayActivity повторно безопасно —
 * launchMode=singleTop предотвращает дублирование.
 */
class BlockOverlayActivity : Activity() {

    companion object {
        const val EXTRA_PACKAGE_NAME = "packageName"
        const val EXTRA_ENDS_AT_MS = "endsAtMs"
        private const val TAG = "block_overlay"
    }

    private val handler = Handler(Looper.getMainLooper())
    private var endsAtMs: Long = 0L
    private var remainingTv: TextView? = null

    private val tickRunnable = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            val remainingMs = endsAtMs - now
            if (remainingMs <= 0) {
                // Сессия только что истекла — закрываем оверлей.
                BlockManager.clearActiveBlock(applicationContext, "overlay-tick-expired")
                finish()
                goHome()
                return
            }
            remainingTv?.text = formatRemaining(remainingMs)
            handler.postDelayed(this, 1000)
        }
    }

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Always-on top, lock-screen bypass.
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                or WindowManager.LayoutParams.FLAG_FULLSCREEN
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        // Скрываем системный UI (status bar / navigation bar) для пущего эффекта.
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )

        setContentView(R.layout.activity_block_overlay)
        remainingTv = findViewById(R.id.block_overlay_remaining)
        val homeBtn = findViewById<Button>(R.id.block_overlay_home)

        endsAtMs = intent?.getLongExtra(EXTRA_ENDS_AT_MS, 0L) ?: 0L
        if (endsAtMs <= System.currentTimeMillis()) {
            // Защита: если activity запустили с истёкшей сессией — сразу выходим.
            DiagLog.write(this, TAG, "onCreate with expired endsAt — finishing immediately")
            finish()
            goHome()
            return
        }

        homeBtn.setOnClickListener {
            DiagLog.write(this, TAG, "user tapped 'Закрыть' (home)")
            finish()
            goHome()
        }

        DiagLog.write(
            this,
            TAG,
            "overlay shown for pkg=${intent?.getStringExtra(EXTRA_PACKAGE_NAME) ?: "?"} endsAtMs=$endsAtMs",
        )
    }

    override fun onResume() {
        super.onResume()
        handler.post(tickRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(tickRunnable)
        // Если ушли с экрана (нажали Home, AccessibilityService переключил
        // ребёнка обратно в blocked app, etc.) — закрываем activity. Следующий
        // TYPE_WINDOW_STATE_CHANGED по blocked package поднимет overlay снова.
        if (!isFinishing) {
            finish()
        }
    }

    @Suppress("DEPRECATION")
    @Deprecated("Backwards-compat for older targets; we swallow back-presses intentionally")
    override fun onBackPressed() {
        // Swallow — пользователь не должен закрыть оверлей через back-button.
        // Только через кнопку «Закрыть» (которая ведёт на Home, не unblock).
        DiagLog.write(this, TAG, "back-press swallowed")
    }

    private fun goHome() {
        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        try {
            startActivity(home)
        } catch (e: Throwable) {
            DiagLog.write(this, TAG, "goHome failed: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun formatRemaining(ms: Long): String {
        val totalSec = (ms / 1000L).toInt()
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return when {
            h > 0 -> "ещё ${h} ч ${m} мин"
            m > 0 -> "ещё ${m} мин ${s} сек"
            else -> "ещё ${s} сек"
        }
    }

}
