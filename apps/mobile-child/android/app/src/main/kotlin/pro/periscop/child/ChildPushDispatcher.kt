package pro.periscop.child

import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * v0.57: единая обработка data-message от backend'а — независимо от того, чем
 * она приехала: FCM ([MyFirebaseMessagingService]) или собственный realtime-канал
 * ([ChildRealtimeClient], WebSocket `/api/child/ws`). Формат data-map одинаковый
 * (его собирает backend в `sendHybridDataMessage`):
 *   - type: START_AUDIO | STOP_AUDIO | BLOCK_APPS | UNBLOCK_APPS | SYNC_RULES |
 *           SYNC_SCHEDULES | PLAY_SIGNAL
 *   - sessionId, wsUrl, durationSec (START_AUDIO); commandId (если есть очередь)
 *
 * `source` — тег для DiagLog ("fcm" / "realtime"), чтобы в логе было видно канал.
 *
 * Все обработчики быстрые: старт сервиса или фоновый Thread под HTTP —
 * FirebaseMessagingService даёт ~10с до ANR, а realtime-колбэк сидит на
 * reader-потоке OkHttp и не должен его блокировать.
 */
object ChildPushDispatcher {

    fun dispatch(ctx: Context, data: Map<String, String>, source: String) {
        val type = data["type"]
        when (type) {
            "START_AUDIO" -> handleStartAudio(ctx, data, source)
            "STOP_AUDIO" -> handleStopAudio(ctx, data, source)
            // v0.39 Phase 6.2 — App Blocking
            "BLOCK_APPS" -> handleBlockApps(ctx, data, source)
            "UNBLOCK_APPS" -> handleUnblockApps(ctx, data, source)
            "SYNC_RULES" -> handleSyncRules(ctx, source)
            // v0.49 Phase 6.x — расписание автоблокировки
            "SYNC_SCHEDULES" -> handleSyncSchedules(ctx, source)
            // v0.43 — мгновенный сигнал «найди телефон» от родителя.
            "PLAY_SIGNAL" -> handlePlaySignal(ctx, data, source)
            else -> DiagLog.write(ctx, source, "unknown type=$type — ignored")
        }
    }

    /**
     * PLAY_SIGNAL → стартуем SignalSoundService (foregroundServiceType=mediaPlayback).
     * Дальше он сам берёт максимальную громкость STREAM_ALARM, бундлованный
     * signal_alarm.wav и вибрацию (см. SignalSoundService.kt). Backend параллельно
     * ставит команду в очередь — если push не доехал, child заберёт её при
     * следующем poll'е.
     */
    private fun handlePlaySignal(ctx: Context, data: Map<String, String>, source: String) {
        val commandId = data["commandId"]
        DiagLog.write(ctx, source, "PLAY_SIGNAL via $source: commandId=${commandId?.take(8) ?: "?"}…")
        val intent = Intent(ctx, SignalSoundService::class.java)
            .setAction(SignalSoundService.ACTION_PLAY)
        startServiceCompat(ctx, intent, source, "PLAY_SIGNAL")

        // v0.44.1: ack команды СРАЗУ после получения, иначе следующий
        // poll-цикл (~90 сек) заберёт её снова и алярм проиграется повторно
        // даже если ребёнок нажал «Остановить». HTTP — в фоновом thread.
        if (!commandId.isNullOrEmpty()) {
            val app = ctx.applicationContext
            Thread {
                try {
                    val res = AppControlHttp.postCommandAck(app, commandId)
                    DiagLog.write(
                        app,
                        source,
                        "PLAY_SIGNAL ack ${commandId.take(8)}… → ok=${res.ok} status=${res.statusCode}",
                    )
                } catch (e: Throwable) {
                    DiagLog.write(
                        app,
                        source,
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
    private fun handleBlockApps(ctx: Context, data: Map<String, String>, source: String) {
        val sessionId = data["sessionId"] ?: return logErr(ctx, source, "BLOCK_APPS without sessionId")
        val endsAtIso = data["endsAt"] ?: return logErr(ctx, source, "BLOCK_APPS without endsAt")
        val endsAtMs = parseIsoToMs(endsAtIso) ?: run {
            logErr(ctx, source, "BLOCK_APPS unparseable endsAt=$endsAtIso")
            return
        }
        DiagLog.write(ctx, source, "BLOCK_APPS via $source: id=${sessionId.take(8)}… endsAt=$endsAtIso")
        BlockManager.setActiveBlock(ctx.applicationContext, sessionId, endsAtMs)
    }

    /** Backend сообщил что сессия закрыта. Чистим локально. */
    private fun handleUnblockApps(ctx: Context, data: Map<String, String>, source: String) {
        val sessionId = data["sessionId"]
        DiagLog.write(ctx, source, "UNBLOCK_APPS via $source: id=${sessionId?.take(8) ?: "?"}…")
        BlockManager.clearActiveBlock(ctx.applicationContext, "$source-unblock")
    }

    /**
     * Backend сообщил что AppRule изменилось. Делаем GET /child/app-rules
     * на background-thread.
     */
    private fun handleSyncRules(ctx: Context, source: String) {
        DiagLog.write(ctx, source, "SYNC_RULES via $source — pulling /child/app-rules")
        val app = ctx.applicationContext
        Thread {
            try {
                val res = AppControlHttp.getAppRules(app)
                if (res.ok && res.bodyJson != null) {
                    BlockManager.applyRulesFromJsonObject(app, res.bodyJson)
                } else {
                    DiagLog.write(app, source, "SYNC_RULES pull failed: status=${res.statusCode}")
                }
            } catch (e: Throwable) {
                DiagLog.write(app, source, "SYNC_RULES exception: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    /**
     * v0.49 Phase 6.x: backend сообщил что список расписаний изменился (CRUD
     * на /family/children/:id/app-control/schedules). Тянем GET /child/schedules
     * и переписываем локальную копию в SharedPreferences. AccessibilityService
     * сразу подхватит новые расписания через [BlockManager.isBlocked].
     */
    private fun handleSyncSchedules(ctx: Context, source: String) {
        DiagLog.write(ctx, source, "SYNC_SCHEDULES via $source — pulling /child/schedules")
        val app = ctx.applicationContext
        Thread {
            try {
                val res = AppControlHttp.getSchedules(app)
                if (res.ok && res.bodyJson != null) {
                    BlockManager.applySchedulesFromJsonObject(app, res.bodyJson)
                } else {
                    DiagLog.write(app, source, "SYNC_SCHEDULES pull failed: status=${res.statusCode}")
                }
            } catch (e: Throwable) {
                DiagLog.write(app, source, "SYNC_SCHEDULES exception: ${e.javaClass.simpleName}: ${e.message}")
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

    private fun handleStartAudio(ctx: Context, data: Map<String, String>, source: String) {
        val sessionId = data["sessionId"] ?: return logErr(ctx, source, "START_AUDIO without sessionId")
        val wsUrl = data["wsUrl"] ?: return logErr(ctx, source, "START_AUDIO without wsUrl")
        val durationSec = data["durationSec"]?.toIntOrNull() ?: 300

        DiagLog.write(
            ctx,
            source,
            "START_AUDIO via $source: sessionId=${sessionId.take(8)}… durationSec=$durationSec",
        )

        val intent = Intent(ctx, SoundAroundService::class.java).apply {
            putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STREAM)
            putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
            putExtra(SoundAroundService.EXTRA_WS_URL, wsUrl)
            putExtra(SoundAroundService.EXTRA_DURATION_SEC, durationSec)
        }
        // При prewarmed SoundAroundService это просто доставка intent'а в уже
        // живой FGS=microphone. FCM high-priority дополнительно даёт elevated
        // state ~10с; realtime-путь полагается на то, что у процесса уже есть
        // FGS (геолокация + prewarm), — так же, как poll-путь из headless-изолята.
        startServiceCompat(ctx, intent, source, "START_AUDIO")
    }

    private fun handleStopAudio(ctx: Context, data: Map<String, String>, source: String) {
        val sessionId = data["sessionId"]
        DiagLog.write(ctx, source, "STOP_AUDIO via $source: sessionId=${sessionId?.take(8) ?: "?"}…")

        val intent = Intent(ctx, SoundAroundService::class.java).apply {
            putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STOP_STREAM)
        }
        try {
            ctx.startService(intent)
        } catch (e: Throwable) {
            DiagLog.write(
                ctx,
                source,
                "STOP_AUDIO startService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }

    /**
     * startForegroundService, а если система не пустила (Android 12+ запрет
     * старта FGS из фона без exemption) — обычный startService: сервис уже
     * живёт в foreground (prewarm), и процесс с FGS фоновым не считается.
     */
    private fun startServiceCompat(ctx: Context, intent: Intent, source: String, label: String) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        } catch (e: Throwable) {
            DiagLog.write(
                ctx,
                source,
                "$label startForegroundService FAILED: ${e.javaClass.simpleName}: ${e.message} — retry startService",
            )
            try {
                ctx.startService(intent)
            } catch (e2: Throwable) {
                DiagLog.write(
                    ctx,
                    source,
                    "$label startService FAILED: ${e2.javaClass.simpleName}: ${e2.message}",
                )
            }
        }
    }

    private fun logErr(ctx: Context, source: String, msg: String) {
        DiagLog.write(ctx, source, "ERROR: $msg")
    }
}
