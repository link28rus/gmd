package pro.periscop.child

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
        // v0.51.1 fix регрессии latency (task #68): POST'им токен на backend
        // СРАЗУ из native кода, не дожидаясь Dart isolate. Это критично потому
        // что onNewToken часто вызывается ПОСЛЕ обновления app через RuStore,
        // когда ребёнок не открывает app — Dart isolate не запущен, токен
        // оставался в pending_token до следующего ручного open. До v0.51.1
        // backend держал старый невалидный токен → push не доставлялись.
        //
        // FCM Service имеет ~10с до ANR — HTTP в отдельном Thread, не блокируя
        // main looper (паттерн handlePlaySignal:103-119).
        Thread {
            try {
                val res = AppControlHttp.postFcmToken(applicationContext, token)
                if (res.ok) {
                    // Обновляем кеш в periscop_fcm чтобы FcmTokenRefreshWorker не
                    // делал лишний POST через ближайшие 6 часов.
                    applicationContext.getSharedPreferences("periscop_fcm", MODE_PRIVATE)
                        .edit()
                        .putString("last_saved_token", token)
                        .putLong("last_saved_at", System.currentTimeMillis())
                        .apply()
                    DiagLog.write(
                        applicationContext,
                        "fcm",
                        "onNewToken: registered on backend (status=${res.statusCode})",
                    )
                } else {
                    // Backend недоступен / 401 (claim не было) / 5xx — fallback
                    // на pending_token, который Dart прочитает при следующем
                    // запуске + FcmTokenRefreshWorker через 6 ч.
                    DiagLog.write(
                        applicationContext,
                        "fcm",
                        "onNewToken: native POST failed status=${res.statusCode} — saved to pending_token for Dart-side retry",
                    )
                    applicationContext.getSharedPreferences("periscop_fcm", MODE_PRIVATE)
                        .edit()
                        .putString("pending_token", token)
                        .putLong("pending_token_ts", System.currentTimeMillis())
                        .apply()
                }
            } catch (e: Throwable) {
                DiagLog.write(
                    applicationContext,
                    "fcm",
                    "onNewToken: native POST exception: ${e.javaClass.simpleName}: ${e.message}",
                )
            }
        }.start()
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        DiagLog.write(this, "fcm", "onMessageReceived type=${data["type"]} from=${remoteMessage.from}")
        // v0.57: обработка общая с realtime-каналом — см. ChildPushDispatcher.
        ChildPushDispatcher.dispatch(this, data, "fcm")
    }
}
