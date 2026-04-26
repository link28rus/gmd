package ru.link28rus.gmd.child

import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * v0.37: Receiver для FCM high-priority data-message от backend'а.
 *
 * Backend в `audio.service.createSession()` шлёт data-message с полями:
 *   - type: "START_AUDIO" | "STOP_AUDIO"
 *   - sessionId, wsUrl, wsToken, ttlSec, durationSec (для START_AUDIO)
 *
 * Высокий priority (`android: { priority: "high" }`) даёт ~10s elevated state
 * на Android — достаточно чтобы стартовать SoundAroundService через простой
 * startService (т.к. service уже в FGS=microphone state благодаря pre-warm
 * из MainActivity.onCreate, см. v0.36.0-rc.1 архитектура).
 *
 * Если pre-warm не активен (юзер не открывал app после ребута) → startService
 * crash'нется в SoundAroundService.handleStream при попытке startForeground
 * type=MICROPHONE из background. Это known limitation, документировано в
 * onboarding.
 *
 * onNewToken() триггерится при first-time token issue или token refresh
 * (rare, но возможно при clear app data или Firebase reset). Сохраняем в
 * SharedPreferences и шлём на backend через ChildApi (нужен device-token =
 * после claim'а, иначе откладываем до next app start).
 */
class MyFirebaseMessagingService : FirebaseMessagingService() {

    override fun onCreate() {
        super.onCreate()
        DiagLog.write(this, "fcm", "MyFirebaseMessagingService created")
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        DiagLog.write(this, "fcm", "onNewToken: ${token.take(16)}…")
        // Сохраняем pending в SharedPreferences. Dart-side при следующем старте
        // прочитает и попытается зарегистрировать на backend.
        getSharedPreferences("gmd_fcm", MODE_PRIVATE)
            .edit()
            .putString("pending_token", token)
            .putLong("pending_token_ts", System.currentTimeMillis())
            .apply()
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        val type = data["type"]
        DiagLog.write(this, "fcm", "onMessageReceived type=$type from=${remoteMessage.from}")

        when (type) {
            "START_AUDIO" -> handleStartAudio(data)
            "STOP_AUDIO" -> handleStopAudio(data)
            else -> DiagLog.write(this, "fcm", "unknown type=$type — ignored")
        }
    }

    private fun handleStartAudio(data: Map<String, String>) {
        val sessionId = data["sessionId"] ?: return logErr("START_AUDIO without sessionId")
        val wsUrl = data["wsUrl"] ?: return logErr("START_AUDIO without wsUrl")
        val durationSec = data["durationSec"]?.toIntOrNull() ?: 300

        DiagLog.write(
            this,
            "fcm",
            "START_AUDIO via FCM: sessionId=${sessionId.take(8)}… durationSec=$durationSec",
        )

        val intent = Intent(this, SoundAroundService::class.java).apply {
            putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STREAM)
            putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
            putExtra(SoundAroundService.EXTRA_WS_URL, wsUrl)
            putExtra(SoundAroundService.EXTRA_DURATION_SEC, durationSec)
        }
        try {
            // FCM high-priority message → app в elevated state ~10s, startForegroundService
            // должен пройти даже если service не в FGS (cold start). При prewarmed
            // service это просто доставка intent.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Throwable) {
            DiagLog.write(
                this,
                "fcm",
                "START_AUDIO startService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }

    private fun handleStopAudio(data: Map<String, String>) {
        val sessionId = data["sessionId"]
        DiagLog.write(this, "fcm", "STOP_AUDIO via FCM: sessionId=${sessionId?.take(8) ?: "?"}…")

        val intent = Intent(this, SoundAroundService::class.java).apply {
            putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STOP_STREAM)
        }
        try {
            startService(intent)
        } catch (e: Throwable) {
            DiagLog.write(
                this,
                "fcm",
                "STOP_AUDIO startService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }

    private fun logErr(msg: String) {
        DiagLog.write(this, "fcm", "ERROR: $msg")
    }
}
