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
 *   - v0.39.4 — fix: Android 12+ HyperOS блокирует startActivity() из background
 *     (`E ActivityTaskManager: Abort background activity starts`). Решение —
 *     **двухступенчатый** ответ: сначала `performGlobalAction(GLOBAL_ACTION_HOME)`
 *     (instant kick на launcher, не требует ни SAW ни BAL exemption), затем
 *     `startActivity(BlockOverlayActivity)` поверх launcher'а (overlay покажется
 *     если есть SYSTEM_ALERT_WINDOW perm, иначе user уже на home — graceful
 *     degradation).
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

            // STEP 1: Instant kick на home через GLOBAL_ACTION_HOME.
            // Это работает ВСЕГДА (a11y system action, не требует BAL exemption ни SAW).
            // Главная гарантия: blocked app исчезает с экрана за ~50ms даже если
            // overlay activity не запустится из-за HyperOS background-activity-start ban.
            val homeOk = try {
                performGlobalAction(GLOBAL_ACTION_HOME)
            } catch (e: Throwable) {
                DiagLog.write(this, TAG, "GLOBAL_ACTION_HOME failed for $pkg: ${e.message}")
                false
            }

            // STEP 2: Поверх launcher'а (если STEP 1 удался) пытаемся показать overlay.
            // Activity start с TYPE_APPLICATION_OVERLAY-like behavior через FLAG_ACTIVITY_NEW_TASK.
            // На Android 12+ HyperOS startActivity из background часто абортится,
            // тогда graceful degradation: пользователь уже на home через STEP 1.
            val intent = Intent(this, BlockOverlayActivity::class.java).apply {
                putExtra(BlockOverlayActivity.EXTRA_PACKAGE_NAME, pkg)
                putExtra(BlockOverlayActivity.EXTRA_ENDS_AT_MS, endsAt)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_NO_HISTORY  // не оставляем в back-stack
            }
            try {
                startActivity(intent)
                DiagLog.write(this, TAG, "blocked $pkg → home=$homeOk + overlay-startActivity dispatched")
            } catch (e: Throwable) {
                DiagLog.write(this, TAG, "blocked $pkg → home=$homeOk + overlay FAILED: ${e.javaClass.simpleName}: ${e.message}")
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
