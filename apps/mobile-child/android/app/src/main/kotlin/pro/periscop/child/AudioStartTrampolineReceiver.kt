package pro.periscop.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Trampoline receiver для обхода Android 14 FGS-microphone background-start ограничения.
 *
 * Проблема (v0.35.0-rc.6):
 *   Android 14 (targetSDK 34) блокирует `startForeground(type=MICROPHONE)` для FGS,
 *   стартующего из background context (locked screen, headless isolate, poll-loop).
 *   Кидает SecurityException с текстом "the app must be in the eligible state/exemptions
 *   to access the foreground only permission" даже при наличии:
 *     - RECORD_AUDIO permission (foreground mode)
 *     - FOREGROUND_SERVICE_MICROPHONE permission
 *     - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS exemption (Doze whitelist)
 *     - Активного FGS=location в том же uid (uidState=FGS, uidBFSL=BFSL)
 *
 * Решение (v0.36.0):
 *   Использовать `AlarmManager.setExactAndAllowWhileIdle()` для schedule alarm на ~200мс.
 *   Когда alarm срабатывает, наш receiver получает TempAllowList exemption на ~10 сек.
 *   В этом окне `startForegroundService(SoundAroundService)` → `startForeground(type=MICROPHONE)`
 *   считается "user-initiated equivalent" и НЕ крашится.
 *
 * См. https://developer.android.com/about/versions/14/changes/fgs-types-required
 * + AlarmManager TempAllowList docs.
 *
 * Trigger:
 *   - Из Dart (audio_command_handler) при получении START_AUDIO команды.
 *   - SoundAroundChannel.start() schedule'ит alarm через 200мс с extras (sessionId/wsUrl/durationSec).
 *
 * NB: receiver НЕ должен делать тяжёлую работу — только startForegroundService.
 * Внутри service делается всё остальное (Flutter engine, recorder, WS).
 */
class AudioStartTrampolineReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_TRAMPOLINE_START =
            "pro.periscop.child.ACTION_AUDIO_TRAMPOLINE_START"
        private const val TAG = "audio_trampoline"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_TRAMPOLINE_START) return

        val sessionId = intent.getStringExtra(SoundAroundService.EXTRA_SESSION_ID).orEmpty()
        val wsUrl = intent.getStringExtra(SoundAroundService.EXTRA_WS_URL).orEmpty()
        val durationSec = intent.getIntExtra(SoundAroundService.EXTRA_DURATION_SEC, 300)

        DiagLog.write(
            context,
            TAG,
            "alarm fired, starting SoundAroundService " +
                "sessionId=${sessionId.take(8)}… durationSec=${durationSec}s",
        )

        if (sessionId.isEmpty() || wsUrl.isEmpty()) {
            DiagLog.write(context, TAG, "missing sessionId/wsUrl — abort")
            return
        }

        // Внутри TempAllowList exemption (~10 сек). startForegroundService
        // → onCreate → onStartCommand → startForeground(type=MICROPHONE) разрешён,
        // потому что system считает caller user-initiated equivalent.
        val svc = Intent(context.applicationContext, SoundAroundService::class.java).apply {
            putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
            putExtra(SoundAroundService.EXTRA_WS_URL, wsUrl)
            putExtra(SoundAroundService.EXTRA_DURATION_SEC, durationSec)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.applicationContext.startForegroundService(svc)
            } else {
                context.applicationContext.startService(svc)
            }
            DiagLog.write(context, TAG, "startForegroundService OK")
        } catch (e: Throwable) {
            DiagLog.write(
                context,
                TAG,
                "startForegroundService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }
}
