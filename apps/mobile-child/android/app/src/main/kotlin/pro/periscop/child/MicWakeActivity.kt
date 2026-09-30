package pro.periscop.child

import android.app.Activity
import android.content.Intent
import android.os.Build

/**
 * v0.62.0 — прозрачная активность «разбудить микрофон».
 *
 * Android 14+ поднимает службу type=microphone только когда у приложения
 * есть видимая активность. Уведомление «Нажми, чтобы Перископ снова работал
 * полностью» ([MicReadiness.showBlockedNotification]) открывает эту активность:
 * в `onResume` она видима → prewarm [SoundAroundService] проходит, и сразу
 * закрывается. Ребёнок видит только мгновенное касание, без открытия UI.
 *
 * Манифест: Theme.Translucent.NoTitleBar, excludeFromRecents, noHistory,
 * taskAffinity="" (своя задача, не поднимает MainActivity), exported=false.
 */
class MicWakeActivity : Activity() {

    companion object {
        const val EXTRA_FROM = "from"
        const val FROM_NOTIFICATION = "notification"
        const val FROM_BOOT = "boot"
        private const val TAG = "sound"
    }

    override fun onResume() {
        super.onResume()
        val from = intent?.getStringExtra(EXTRA_FROM) ?: "direct"
        if (from == FROM_NOTIFICATION) MicReadiness.onNotificationTapped(this)
        DiagLog.write(
            this,
            TAG,
            "MicWakeActivity: opened from=$from serviceState=${SoundAroundService.state} " +
                "importance=${DiagSnapshot.processImportance()} → prewarm",
        )
        try {
            val prewarm = Intent(this, SoundAroundService::class.java)
                .putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_PREWARM)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(prewarm)
            } else {
                startService(prewarm)
            }
        } catch (e: Throwable) {
            DiagLog.write(
                this,
                TAG,
                "MicWakeActivity: prewarm dispatch FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
        finish()
    }

    override fun finish() {
        super.finish()
        // Без анимации закрытия — окно прозрачное, мигать нечему.
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }
}
