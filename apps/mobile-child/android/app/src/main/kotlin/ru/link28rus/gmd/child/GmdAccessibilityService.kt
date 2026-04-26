package ru.link28rus.gmd.child

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * v0.39 Phase 6.2 — детектор foreground app для блокировки приложений.
 *
 * История класса:
 *   - v0.27..v0.29.1 — использовался для PIN-lock (защита от удаления).
 *   - v0.29.2 — PIN-lock удалён, сервис стал no-op (но класс оставлен +
 *     убран `<service>` из манифеста, чтобы Android отключил у уже включивших).
 *   - v0.39 — реактивирован для блокировки приложений: ловит TYPE_WINDOW_STATE_CHANGED,
 *     если foreground package — `BlockManager.isBlocked(...)` → запускает
 *     [BlockOverlayActivity]. Защита от удаления держится по-прежнему на Device Admin L1.
 *
 * **Throttling:** TYPE_WINDOW_STATE_CHANGED спамит десятки раз/сек при scroll'е —
 * между запусками одного и того же overlay для одного и того же package
 * выдерживаем 500 мс паузу. На разные packages срабатываем сразу.
 *
 * **Self-skip:** игнорируем события от самих себя (наш child app, BlockOverlayActivity,
 * любые системные packages из safety list — обрабатываются в BlockManager).
 */
class GmdAccessibilityService : AccessibilityService() {

    private var lastBlockedPkg: String? = null
    private var lastOverlayLaunchMs: Long = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val ev = event ?: return
        if (ev.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val pkg = ev.packageName?.toString() ?: return
        // Skip own packages (наш app, оверлей, system).
        if (pkg == applicationContext.packageName) return

        try {
            if (!BlockManager.isBlocked(applicationContext, pkg)) {
                // Сбрасываем «debounce» если ребёнок переключился на не-blocked
                // app — следующий блок откроем сразу, без 500ms паузы.
                if (lastBlockedPkg != null) {
                    lastBlockedPkg = null
                }
                return
            }

            // Throttle: повторный TYPE_WINDOW_STATE_CHANGED для того же package
            // в окне 500мс игнорируем. Иначе overlay будет multi-launch'иться
            // когда blocked app внутри показывает диалог/системный popup.
            val now = System.currentTimeMillis()
            if (pkg == lastBlockedPkg && (now - lastOverlayLaunchMs) < 500L) return

            lastBlockedPkg = pkg
            lastOverlayLaunchMs = now

            val active = BlockManager.getActiveBlock(applicationContext)
            // ALWAYS_BLOCKED не имеет endsAt — берём «бесконечность» = +1 час
            // (overlay всё равно перепроверит и сам зачистит когда сессия снимется).
            val endsAt = active?.endsAtMs ?: (now + 3600_000L)

            val intent = Intent(this, BlockOverlayActivity::class.java).apply {
                putExtra(BlockOverlayActivity.EXTRA_PACKAGE_NAME, pkg)
                putExtra(BlockOverlayActivity.EXTRA_ENDS_AT_MS, endsAt)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_NO_HISTORY  // не оставляем в back-stack
            }
            try {
                startActivity(intent)
                DiagLog.write(this, TAG, "overlay launched for $pkg endsAt=$endsAt")
            } catch (e: Throwable) {
                DiagLog.write(this, TAG, "startActivity failed for $pkg: ${e.javaClass.simpleName}: ${e.message}")
            }
        } catch (e: Throwable) {
            // Never crash — a11y exceptions могут отключить сервис.
            DiagLog.write(this, TAG, "onAccessibilityEvent crashed: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    override fun onInterrupt() {
        // no-op
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        DiagLog.write(this, TAG, "service connected")
    }

    private companion object {
        private const val TAG = "a11y_block"
    }
}
