package ru.link28rus.gmd.child

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

/**
 * FGS type=microphone для «Звук вокруг ребёнка» (D-lite архитектура, v0.36.0).
 *
 * v0.36.0 D-lite (pre-warm strategy):
 *   Android 14 (targetSDK 34) запрещает `startForeground(type=MICROPHONE)` из background
 *   (locked screen, headless isolate, alarm trampoline) с SecurityException
 *   "the app must be in the eligible state/exemptions to access the foreground only permission".
 *   Ни Doze whitelist, ни AlarmManager TempAllowList exemption не помогают —
 *   только Activity tap / FCM push / MediaSession callback дают exemption.
 *
 *   Решение БЕЗ внешних push-сервисов: pre-warm Service из MainActivity.onCreate
 *   (Activity visible = foreground = exemption applies), потом service остаётся
 *   жить в FGS state даже после ухода Activity. uidState=FGS даёт mic access.
 *
 *   Mic-indicator (зелёная точка) появляется ТОЛЬКО при активном AudioRecord,
 *   не при FGS=microphone в idle — потому что privacy indicator смотрит на
 *   AppOpsManager.OP_RECORD_AUDIO active state, не на FGS type.
 *
 * Modes:
 *   MODE_PREWARM   — startForeground(type=MICROPHONE), сидит без AudioRecord/FlutterEngine.
 *                    Идемпотентен — повторный prewarm = no-op.
 *   MODE_STREAM    — startForeground (idempotent) + Flutter engine + AudioRecord.
 *                    Если service уже в prewarm/stream — просто переключает на stream.
 *   MODE_STOP_STREAM — stop FlutterEngine + release wake lock, остаётся в FGS=prewarm.
 *                      Готов к следующему STREAM. Это нормальное завершение сессии.
 *   ACTION_STOP    — полная остановка (для ручного отключения / cleanup).
 *
 * Lifecycle:
 *   - START_STICKY: если процесс убит OEM, system перезапустит с null intent → handlePrewarm.
 *   - onTaskRemoved: НЕ убивает service (раньше убивал — это ломало pre-warm после свайпа recents).
 *     Service оставляем жить, иначе следующий «Звук вокруг» снова крашится.
 */
class SoundAroundService : Service() {

    companion object {
        private const val TAG = "sound"
        private const val NOTIFICATION_ID = 4711
        private const val NOTIFICATION_CHANNEL_ID = "gmd_sound_around"

        // Режимы передаются через EXTRA_MODE intent extra. Отсутствие mode = MODE_PREWARM
        // (это путь после OEM kill + START_STICKY restart с null intent).
        const val EXTRA_MODE = "mode"
        const val MODE_PREWARM = "prewarm"
        const val MODE_STREAM = "stream"
        const val MODE_STOP_STREAM = "stop_stream"

        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_WS_URL = "wsUrl"
        const val EXTRA_DURATION_SEC = "durationSec"
        const val ACTION_STOP = "ru.link28rus.gmd.child.ACTION_SOUND_AROUND_STOP"
        private const val WAKE_LOCK_TAG = "gmd:SoundAroundService"

        private const val DART_LIBRARY_URI =
            "package:gmd_child/features/sound_around/sound_around_entry.dart"
        private const val DART_ENTRYPOINT = "soundAroundEntryPoint"
        private const val BG_CHANNEL = "gmd.child/sound_around_bg"
    }

    private var flutterEngine: FlutterEngine? = null
    private var bgChannel: MethodChannel? = null
    private var wakeLock: PowerManager.WakeLock? = null
    // True после первого успешного startForeground(type=MICROPHONE) в этом instance.
    // Защищает от лишних `startForeground` при mode=stream поверх prewarm.
    private var inForegroundState: Boolean = false

    private fun log(msg: String) = DiagLog.write(this, TAG, msg)
    private fun logErr(msg: String, e: Throwable) =
        DiagLog.write(this, TAG, "$msg: ${e.javaClass.simpleName}: ${e.message}")

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        log("onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_PREWARM
        log("onStartCommand action=$action mode=$mode flags=$flags startId=$startId")

        // Legacy ACTION_STOP — полное завершение (cleanup, для админских сценариев).
        if (action == ACTION_STOP) {
            log("ACTION_STOP received — full stop")
            handleFullStop()
            return START_NOT_STICKY
        }

        when (mode) {
            MODE_PREWARM -> handlePrewarm()
            MODE_STREAM -> handleStream(intent)
            MODE_STOP_STREAM -> handleStopStream()
            else -> {
                log("unknown mode=$mode — defaulting to prewarm")
                handlePrewarm()
            }
        }

        // START_STICKY: после OEM kill system пересоздаст с null intent → handlePrewarm.
        // Это поддерживает persistent pre-warmed state, переживающий MIUI memory pressure.
        return START_STICKY
    }

    /**
     * Pre-warm: поднять FGS=microphone в idle. Без AudioRecord, без Flutter engine.
     * Идемпотентен — если уже в FGS state, ничего не делает.
     *
     * ВАЖНО: первый вызов ДОЛЖЕН быть когда app в foreground (Activity visible),
     * иначе `startForeground(type=MICROPHONE)` крашится с SecurityException.
     * MainActivity.onCreate триггерит этот mode при открытии приложения.
     */
    private fun handlePrewarm() {
        if (inForegroundState) {
            log("prewarm: already in FGS state — no-op")
            return
        }
        try {
            startForegroundCompat()
            inForegroundState = true
            log("prewarm: startForeground(type=MICROPHONE) OK — service idle, ready for STREAM")
        } catch (e: Throwable) {
            // Если crash тут — значит prewarm вызван из background context.
            // Это известное Android 14 ограничение, документируем для пользователя.
            logErr("prewarm: startForeground FAILED (need foreground caller)", e)
            stopSelf()
        }
    }

    /**
     * Stream: активировать AudioRecord + WS connection.
     * Если service ещё не в FGS (например первый старт сразу с STREAM, без prewarm) —
     * пытаемся startForeground. Это сработает только если caller имеет mic exemption
     * (foreground Activity / push). При locked screen без prewarm — крашится.
     */
    private fun handleStream(intent: Intent?) {
        if (flutterEngine != null) {
            log("stream: Flutter engine already active — duplicate start ignored")
            return
        }
        // Идемпотентный startForeground — если уже в prewarm, system не делает ничего лишнего.
        if (!inForegroundState) {
            try {
                startForegroundCompat()
                inForegroundState = true
                log("stream: startForeground OK (lazy, no prewarm before)")
            } catch (e: Throwable) {
                logErr("stream: startForeground FAILED — likely no prewarm + background caller", e)
                stopSelf()
                return
            }
        }

        val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID).orEmpty()
        val wsUrl = intent?.getStringExtra(EXTRA_WS_URL).orEmpty()
        val durationSec = intent?.getIntExtra(EXTRA_DURATION_SEC, 300) ?: 300

        if (sessionId.isEmpty() || wsUrl.isEmpty()) {
            log("stream: missing sessionId/wsUrl — abort STREAM, остаюсь в prewarm")
            return
        }

        // Wake lock только когда реально стримим — экономия батареи в prewarm idle.
        acquireWakeLock()
        startFlutterEngine(sessionId, wsUrl, durationSec)
    }

    /**
     * Stop stream: остановить AudioRecord/Flutter, остаться в FGS=prewarm.
     * Готов к следующему STREAM без нового startForeground (= без SecurityException).
     */
    private fun handleStopStream() {
        log("stop_stream: tearing down Flutter engine, staying in prewarm FGS")
        try {
            flutterEngine?.destroy()
        } catch (e: Throwable) {
            logErr("stop_stream: engine.destroy failed", e)
        }
        flutterEngine = null
        bgChannel = null
        releaseWakeLock()
        // НЕ stopForeground/stopSelf — service остаётся живым для следующей сессии.
    }

    /**
     * Полная остановка — для admin reset / app uninstall preparation.
     * Снимает FGS, освобождает все ресурсы, stopSelf.
     */
    private fun handleFullStop() {
        try {
            flutterEngine?.destroy()
        } catch (_: Throwable) { /* ignore */ }
        flutterEngine = null
        bgChannel = null
        releaseWakeLock()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        inForegroundState = false
        stopSelf()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // v0.36.0 D-lite: НЕ убиваем сервис на свайп recents — иначе теряем prewarm
        // и следующий «Звук вокруг» крашится. Service переживает task removal
        // и остаётся доступен для STREAM команд из background isolate.
        log("onTaskRemoved → ignored, keeping prewarm FGS alive")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        log("onDestroy")
        flutterEngine?.destroy()
        flutterEngine = null
        bgChannel = null
        releaseWakeLock()
        inForegroundState = false
        super.onDestroy()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
                setReferenceCounted(false)
                // Без таймаута: держим пока стрим активен. Освобождаем в handleStopStream/onDestroy.
                acquire()
            }
            log("wakeLock acquired")
        } catch (e: Throwable) {
            logErr("acquireWakeLock failed", e)
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Throwable) {
            // already released
        }
        wakeLock = null
    }

    private fun startFlutterEngine(sessionId: String, wsUrl: String, durationSec: Int) {
        log("startFlutterEngine sessionId=${sessionId.take(8)}… durationSec=$durationSec")
        try {
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(applicationContext)
            loader.ensureInitializationComplete(applicationContext, null)

            val engine = FlutterEngine(applicationContext)
            // КРИТИЧНО: при ручном создании FlutterEngine (не через FlutterActivity) плагины
            // НЕ регистрируются автоматически. Без этого вызова в headless-изоляте все
            // MethodChannel'ы падают с MissingPluginException.
            GeneratedPluginRegistrant.registerWith(engine)

            val entrypoint = DartExecutor.DartEntrypoint(
                loader.findAppBundlePath(),
                DART_LIBRARY_URI,
                DART_ENTRYPOINT,
            )
            engine.dartExecutor.executeDartEntrypoint(entrypoint)

            val channel = MethodChannel(engine.dartExecutor.binaryMessenger, BG_CHANNEL)
            channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "stopSelf" -> {
                        // v0.36.0: вместо полного stopSelf — переходим в STOP_STREAM,
                        // оставляя FGS=prewarm для следующего вызова.
                        val reason = call.argument<String>("reason") ?: "unknown"
                        log("Dart requested stop: $reason → handleStopStream")
                        handleStopStream()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

            // Диагностический канал для headless Dart: принимает diagLog('sa_bg', 'msg').
            MethodChannel(
                engine.dartExecutor.binaryMessenger,
                "ru.link28rus.gmd.child/diag",
            ).setMethodCallHandler { call, result ->
                when (call.method) {
                    "write" -> {
                        val diagTag = call.argument<String>("tag") ?: "sa_bg"
                        val msg = call.argument<String>("msg") ?: ""
                        DiagLog.write(applicationContext, diagTag, msg)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

            // Передать параметры сессии в Dart entry-point.
            channel.invokeMethod(
                "init",
                mapOf(
                    "sessionId" to sessionId,
                    "wsUrl" to wsUrl,
                    "durationSec" to durationSec,
                ),
            )

            flutterEngine = engine
            bgChannel = channel
            log("startFlutterEngine OK")
        } catch (e: Throwable) {
            logErr("startFlutterEngine FAILED", e)
            handleStopStream()
        }
    }

    private fun startForegroundCompat() {
        val notif = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notif)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(NOTIFICATION_CHANNEL_ID) != null) return
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Аудиомониторинг",
                NotificationManager.IMPORTANCE_MIN, // самый низкий — без heads-up
            ).apply {
                description = "Активная сессия аудиомониторинга"
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    /**
     * Минималистичная notification — required by Android для FGS, но мы
     * делаем её максимально невыразительной (IMPORTANCE_MIN).
     *
     * v0.36.0: эта нотификация теперь висит ПОСТОЯННО (после первого открытия app),
     * не только во время сессии — потому что service в pre-warm idle.
     * Mic-indicator (зелёная точка) появляется только при активном AudioRecord.
     */
    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("gmd")
            .setContentText("Готов к аудиомониторингу")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }
}
