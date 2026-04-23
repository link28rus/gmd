package ru.link28rus.gmd.child

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

// L2-защита: перехватывает экраны системных Settings, на которых ребёнок
// может пытаться удалить приложение или отключить Device Admin. При детекте —
// отправляет BACK и запускает PinLockActivity. Grace-period после успешного
// verify (30 сек) хранится в SharedPreferences — чтобы разрешить пользователю
// завершить законное действие после ввода PIN.
class GmdAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        // Родитель мог выключить тумблер в кабинете — в этом случае L2
        // пропускает любые экраны без перехвата. Кеш обновляется каждый раз
        // когда UI дёргает GET /child/protection.
        if (!NativeCreds.isProtectionEnabled(this)) return

        val root = rootInActiveWindow ?: return
        val texts = collectTexts(root, maxDepth = 8)
        if (texts.isEmpty()) return

        if (!looksLikeDangerousScreen(texts)) return

        // Grace-period: если пользователь недавно ввёл корректный PIN —
        // пропускаем без блокировки.
        val grace = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_UNLOCKED_UNTIL, 0L)
        if (System.currentTimeMillis() < grace) {
            DiagLog.write(this, "a11y", "dangerous screen detected, grace-period active")
            return
        }

        DiagLog.write(this, "a11y", "dangerous screen detected, launching PIN lock")
        performGlobalAction(GLOBAL_ACTION_BACK)
        showPinLockNotification()
    }

    // Full-screen notification — обход background activity start restriction
    // на Android 12+ / HyperOS. Android при IMPORTANCE_HIGH + fullScreenIntent
    // сразу запускает Activity, не показывая notification если экран активен.
    private fun showPinLockNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Родительский контроль",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Запрос PIN при попытке отключения защиты"
                setBypassDnd(true)
            }
            nm.createNotificationChannel(channel)
        }

        val pinIntent = Intent(this, PinLockActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(this, 0, pinIntent, pendingFlags)

        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("Введите PIN родителя")
            .setContentText("Для отключения защиты gmd_child")
            .setPriority(Notification.PRIORITY_MAX)
            .setCategory(Notification.CATEGORY_CALL)
            .setFullScreenIntent(pendingIntent, true)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        nm.notify(NOTIF_ID, notification)
        DiagLog.write(this, "a11y", "pin-lock notification posted (fullScreenIntent)")
    }

    override fun onInterrupt() {
        // no-op
    }

    private fun collectTexts(node: AccessibilityNodeInfo?, depth: Int = 0, maxDepth: Int): List<String> {
        if (node == null || depth > maxDepth) return emptyList()
        val result = mutableListOf<String>()
        node.text?.toString()?.takeIf { it.isNotBlank() }?.let { result.add(it.lowercase()) }
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { result.add(it.lowercase()) }
        for (i in 0 until node.childCount) {
            result.addAll(collectTexts(node.getChild(i), depth + 1, maxDepth))
        }
        return result
    }

    // Нам важно поймать экраны, где ребёнок может подтвердить удаление/
    // деактивацию. Матчим:
    //  - диалог Uninstall (пакетный менеджер): содержит "gmd_child"+"удалить"/"uninstall"
    //  - экран Deactivate admin: содержит "отключить/deactivate" + "администратор/administrator"
    //  - Force stop: опционально (force stop не удаляет приложение, но
    //    глушит foreground service — тоже критично)
    private fun looksLikeDangerousScreen(texts: List<String>): Boolean {
        val joined = texts.joinToString(" | ")
        val isOurApp = joined.contains("gmd") || joined.contains("ru.link28rus.gmd.child")

        val hasUninstall = joined.contains("удалить") ||
            joined.contains("uninstall") ||
            joined.contains("delete") ||
            joined.contains("снести")

        val hasDeactivate = (joined.contains("отключить") || joined.contains("deactivate") ||
            joined.contains("disable")) &&
            (joined.contains("админ") || joined.contains("admin"))

        val hasForceStop = joined.contains("остановить") || joined.contains("force stop") ||
            joined.contains("принудительно")

        val hasClearData = joined.contains("очистить данные") || joined.contains("clear data") ||
            joined.contains("стереть данные")

        // hasDeactivate сам по себе триггерит (экран Device Admin отдельный,
        // приложение может быть не named на нём до клика). Остальные —
        // только когда видно что это про наше приложение.
        return hasDeactivate || (isOurApp && (hasUninstall || hasForceStop || hasClearData))
    }

    companion object {
        const val PREFS = "gmd_a11y"
        const val KEY_UNLOCKED_UNTIL = "unlocked_until_ms"
        const val GRACE_PERIOD_MS = 30_000L
        private const val CHANNEL_ID = "gmd_pin_lock"
        private const val NOTIF_ID = 8102

        fun setGracePeriod(context: Context) {
            val until = System.currentTimeMillis() + GRACE_PERIOD_MS
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_UNLOCKED_UNTIL, until)
                .apply()
        }
    }
}
