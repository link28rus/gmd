package pro.periscop.child

import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * v0.57: единая обработка data-message от backend'а — независимо от того, чем
 * она приехала: FCM ([MyFirebaseMessagingService]) или собственный realtime-канал
 * ([ChildRealtimeClient], WebSocket `/api/child/ws`). Формат data-map одинаковый
 * (его собирает backend в `sendHybridDataMessage`):
 *   - type: START_AUDIO | STOP_AUDIO | PLAY_SIGNAL | DIAG_CONFIG | UPLOAD_DIAG
 *   - sessionId, wsUrl, durationSec (START_AUDIO); commandId (если есть очередь)
 *   - config — DiagConfig JSON-строкой (DIAG_CONFIG, v0.60.0)
 *
 * `source` — тег для DiagLog ("fcm" / "realtime"), чтобы в логе было видно канал.
 *
 * Все обработчики быстрые: старт сервиса или фоновый Thread под HTTP —
 * FirebaseMessagingService даёт ~10с до ANR, а realtime-колбэк сидит на
 * reader-потоке OkHttp и не должен его блокировать.
 */
object ChildPushDispatcher {

    // v0.60.0: подробные записи пути START_AUDIO/STOP_AUDIO — под тегом
    // категории audio, чтобы включались вместе с остальным «Звуком вокруг».
    private const val AUDIO_TAG = "sound"

    fun dispatch(ctx: Context, data: Map<String, String>, source: String) {
        val type = data["type"]
        when (type) {
            "START_AUDIO" -> handleStartAudio(ctx, data, source)
            "STOP_AUDIO" -> handleStopAudio(ctx, data, source)
            // v0.43 — мгновенный сигнал «найди телефон» от родителя.
            "PLAY_SIGNAL" -> handlePlaySignal(ctx, data, source)
            // v0.60.0 — журнал на сервере: настройки (состояние, не команда)
            // и запрос журнала (команда из очереди, отметка — сам upload с commandId).
            "DIAG_CONFIG" -> handleDiagConfig(ctx, data, source)
            "UPLOAD_DIAG" -> DiagUpload.requestManual(ctx, data["commandId"], source)
            // BLOCK_APPS / UNBLOCK_APPS / SYNC_RULES / SYNC_SCHEDULES — блокировка
            // приложений временно отключена (v0.58.0), падают сюда и игнорируются.
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

    private fun handleDiagConfig(ctx: Context, data: Map<String, String>, source: String) {
        val raw = data["config"]
        if (raw.isNullOrBlank()) {
            DiagLog.write(ctx, DiagUpload.TAG, "DIAG_CONFIG via $source without config — ignored")
            return
        }
        val cfg = DiagConfigStore.save(ctx, raw)
        DiagLog.write(ctx, DiagUpload.TAG, "config via $source: ${cfg.summary(System.currentTimeMillis())}")
    }

    private fun handleStartAudio(ctx: Context, data: Map<String, String>, source: String) {
        DiagLog.debug(
            ctx,
            AUDIO_TAG,
            "START_AUDIO received via $source keys=${data.keys.sorted()} " +
                "commandId=${data["commandId"]?.take(8) ?: "-"} serviceState=${SoundAroundService.state} " +
                "importance=${DiagSnapshot.processImportance()} sdk=${Build.VERSION.SDK_INT}",
        )
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
        val started = startServiceCompat(ctx, intent, source, "START_AUDIO")
        if (!started) {
            // v0.62.0: служба микрофона даже не стартовала — сразу FAILED на сервер,
            // уведомление ребёнку «нажми, чтобы Перископ снова работал».
            MicReadiness.set(ctx, false, "START_AUDIO via $source: служба не запустилась")
            MicReadiness.showBlockedNotification(ctx, "START_AUDIO start FAILED")
            MicReadiness.reportMicBlocked(ctx, sessionId, "START_AUDIO via $source: службу микрофона не запустить из фона")
            DiagUpload.autoTrigger(ctx, DiagUpload.TRIGGER_START_FAILED)
        }
    }

    private fun handleStopAudio(ctx: Context, data: Map<String, String>, source: String) {
        val sessionId = data["sessionId"]
        DiagLog.write(ctx, source, "STOP_AUDIO via $source: sessionId=${sessionId?.take(8) ?: "?"}…")
        DiagLog.debug(
            ctx,
            AUDIO_TAG,
            "STOP_AUDIO received via $source serviceState=${SoundAroundService.state}",
        )

        val intent = Intent(ctx, SoundAroundService::class.java).apply {
            putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STOP_STREAM)
        }
        try {
            ctx.startService(intent)
            DiagLog.debug(ctx, AUDIO_TAG, "STOP_AUDIO startService OK")
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
    private fun startServiceCompat(ctx: Context, intent: Intent, source: String, label: String): Boolean {
        val debugTag = if (label.contains("AUDIO")) AUDIO_TAG else "signal"
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            DiagLog.debug(ctx, debugTag, "$label startForegroundService OK (via $source)")
            return true
        } catch (e: Throwable) {
            DiagLog.write(
                ctx,
                source,
                "$label startForegroundService FAILED: ${e.javaClass.simpleName}: ${e.message} — retry startService",
            )
            DiagLog.debug(ctx, debugTag, "$label startForegroundService exception class=${e.javaClass.name}")
            try {
                ctx.startService(intent)
                DiagLog.debug(ctx, debugTag, "$label fallback startService OK (via $source)")
                return true
            } catch (e2: Throwable) {
                DiagLog.write(
                    ctx,
                    source,
                    "$label startService FAILED: ${e2.javaClass.simpleName}: ${e2.message}",
                )
                DiagLog.debug(ctx, debugTag, "$label startService exception class=${e2.javaClass.name}")
                return false
            }
        }
    }

    private fun logErr(ctx: Context, source: String, msg: String) {
        DiagLog.write(ctx, source, "ERROR: $msg")
    }
}
