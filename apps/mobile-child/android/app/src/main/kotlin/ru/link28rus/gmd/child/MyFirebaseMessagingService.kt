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
                    // Обновляем кеш в gmd_fcm чтобы FcmTokenRefreshWorker не
                    // делал лишний POST через ближайшие 6 часов.
                    applicationContext.getSharedPreferences("gmd_fcm", MODE_PRIVATE)
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
                    applicationContext.getSharedPreferences("gmd_fcm", MODE_PRIVATE)
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
        val type = data["type"]
        DiagLog.write(this, "fcm", "onMessageReceived type=$type from=${remoteMessage.from}")

        when (type) {
            "START_AUDIO" -> handleStartAudio(data)
            "STOP_AUDIO" -> handleStopAudio(data)
            // v0.39 Phase 6.2 — App Blocking
            "BLOCK_APPS" -> handleBlockApps(data)
            "UNBLOCK_APPS" -> handleUnblockApps(data)
            "SYNC_RULES" -> handleSyncRules()
            // v0.49 Phase 6.x — расписание автоблокировки
            "SYNC_SCHEDULES" -> handleSyncSchedules()
            // v0.43 — мгновенный сигнал «найди телефон» от родителя.
            "PLAY_SIGNAL" -> handlePlaySignal(data)
            else -> DiagLog.write(this, "fcm", "unknown type=$type — ignored")
        }
    }

    /**
     * Получаем PLAY_SIGNAL data-message → стартуем SignalSoundService.
     * Сервис foregroundServiceType=mediaPlayback — стартует и из background
     * благодаря FCM high-priority elevated-state (~10с). Дальше сам берёт на себя
     * максимальную громкость STREAM_ALARM, бундлованный signal_alarm.wav и
     * вибрацию (см. SignalSoundService.kt). Backend параллельно ставит команду
     * в очередь — если push не доехал, child заберёт её при следующем poll'е.
     */
    private fun handlePlaySignal(data: Map<String, String>) {
        val commandId = data["commandId"]
        DiagLog.write(this, "fcm", "PLAY_SIGNAL via FCM: commandId=${commandId?.take(8) ?: "?"}…")
        val intent = Intent(this, SignalSoundService::class.java)
            .setAction(SignalSoundService.ACTION_PLAY)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Throwable) {
            DiagLog.write(
                this,
                "fcm",
                "PLAY_SIGNAL startService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }

        // v0.44.1: ack команды СРАЗУ после получения FCM, иначе следующий
        // poll-цикл (~90 сек) забёрет её снова и алярм проиграется повторно
        // даже если ребёнок нажал «Остановить». Делаем в фоновом thread:
        // FirebaseMessagingService onMessageReceived имеет ~10с до ANR,
        // HTTP не должен блокировать main.
        if (!commandId.isNullOrEmpty()) {
            Thread {
                try {
                    val res = AppControlHttp.postCommandAck(applicationContext, commandId)
                    DiagLog.write(
                        applicationContext,
                        "fcm",
                        "PLAY_SIGNAL ack ${commandId.take(8)}… → ok=${res.ok} status=${res.statusCode}",
                    )
                } catch (e: Throwable) {
                    DiagLog.write(
                        applicationContext,
                        "fcm",
                        "PLAY_SIGNAL ack failed: ${e.javaClass.simpleName}: ${e.message}",
                    )
                }
            }.start()
        }
    }

    /**
     * Backend отправил {sessionId, endsAt} — сохраняем активную блок-сессию
     * в [BlockManager]. AccessibilityService уже подключен (если ребёнок дал
     * permission) и сразу начнёт ловить попытки открыть blocked app.
     */
    private fun handleBlockApps(data: Map<String, String>) {
        val sessionId = data["sessionId"] ?: return logErr("BLOCK_APPS without sessionId")
        val endsAtIso = data["endsAt"] ?: return logErr("BLOCK_APPS without endsAt")
        val endsAtMs = parseIsoToMs(endsAtIso) ?: run {
            logErr("BLOCK_APPS unparseable endsAt=$endsAtIso")
            return
        }
        DiagLog.write(this, "fcm", "BLOCK_APPS via FCM: id=${sessionId.take(8)}… endsAt=$endsAtIso")
        BlockManager.setActiveBlock(applicationContext, sessionId, endsAtMs)
    }

    /** Backend сообщил что сессия закрыта. Чистим локально. */
    private fun handleUnblockApps(data: Map<String, String>) {
        val sessionId = data["sessionId"]
        DiagLog.write(this, "fcm", "UNBLOCK_APPS via FCM: id=${sessionId?.take(8) ?: "?"}…")
        BlockManager.clearActiveBlock(applicationContext, "fcm-unblock")
    }

    /**
     * Backend сообщил что AppRule изменилось. Делаем GET /child/app-rules
     * на background-thread (FCM service на Android 14+ может убиться через 10с,
     * поэтому Thread без глубокой работы).
     */
    private fun handleSyncRules() {
        DiagLog.write(this, "fcm", "SYNC_RULES via FCM — pulling /child/app-rules")
        Thread {
            try {
                val res = AppControlHttp.getAppRules(applicationContext)
                if (res.ok && res.bodyJson != null) {
                    BlockManager.applyRulesFromJsonObject(applicationContext, res.bodyJson)
                } else {
                    DiagLog.write(this, "fcm", "SYNC_RULES pull failed: status=${res.statusCode}")
                }
            } catch (e: Throwable) {
                DiagLog.write(this, "fcm", "SYNC_RULES exception: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    /**
     * v0.49 Phase 6.x: backend сообщил что список расписаний изменился (CRUD
     * на /family/children/:id/app-control/schedules). Тянем GET /child/schedules
     * и переписываем локальную копию в SharedPreferences. AccessibilityService
     * сразу подхватит новые расписания через [BlockManager.isBlocked].
     */
    private fun handleSyncSchedules() {
        DiagLog.write(this, "fcm", "SYNC_SCHEDULES via FCM — pulling /child/schedules")
        Thread {
            try {
                val res = AppControlHttp.getSchedules(applicationContext)
                if (res.ok && res.bodyJson != null) {
                    BlockManager.applySchedulesFromJsonObject(applicationContext, res.bodyJson)
                } else {
                    DiagLog.write(this, "fcm", "SYNC_SCHEDULES pull failed: status=${res.statusCode}")
                }
            } catch (e: Throwable) {
                DiagLog.write(this, "fcm", "SYNC_SCHEDULES exception: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    /** ISO-8601 (`2026-04-26T10:43:24.000Z`) → epoch millis. */
    private fun parseIsoToMs(iso: String): Long? = try {
        // Простой парсер без java.time зависимостей: формат фиксирован backend'ом.
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.parse(iso)?.time
    } catch (_: Throwable) {
        null
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
