package ru.link28rus.gmd.child

import android.accessibilityservice.AccessibilityService
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

            // v0.49 Phase 6.x: endsAt = max(BlockSession.endsAt, активное расписание endsAt).
            // Если оба null (= ALWAYS_BLOCKED), ставим +1 час, overlay всё равно
            // перепроверит и сам зачистит при следующем tick'е если правило снимется.
            val combinedEndsAt = BlockManager.getCurrentBlockEndsAtMs(applicationContext)
            val endsAt = if (combinedEndsAt > 0L) combinedEndsAt else (now + 3600_000L)

            // STEP 1: Visual overlay через TYPE_APPLICATION_OVERLAY (v0.39.5).
            // Не Activity → BAL ограничения не распространяются. Требует SAW perm,
            // если нет — silent no-op, fallback'нёмся на STEP 2.
            OverlayManager.show(applicationContext, endsAt)

            // STEP 2: GLOBAL_ACTION_HOME — гарантированный kick на launcher.
            // Работает ВСЕГДА (a11y system action, не требует ни BAL exemption ни SAW).
            // Если SAW есть и overlay показался — overlay поверх launcher'а (visually
            // правильно). Если SAW нет — ребёнок просто на launcher (graceful).
            val homeOk = try {
                performGlobalAction(GLOBAL_ACTION_HOME)
            } catch (e: Throwable) {
                DiagLog.write(this, TAG, "GLOBAL_ACTION_HOME failed for $pkg: ${e.message}")
                false
            }

            DiagLog.write(
                this,
                TAG,
                "blocked $pkg → overlay=${OverlayManager.isShowing()} home=$homeOk endsAt=$endsAt",
            )
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
