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
import androidx.core.app.NotificationCompat
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

/**
 * FGS type=microphone для «Звук вокруг ребёнка» (Phase 5.3, Plan B).
 *
 * Запускается из Flutter (SoundAroundChannel.start) при получении
 * START_AUDIO команды через DeviceCommand poll. Поднимает headless
 * FlutterEngine с entry-point `soundAroundEntryPoint` (определён в
 * lib/features/sound_around/sound_around_entry.dart, создаётся в Task 7).
 *
 * foregroundServiceType=microphone — обязательное требование Android 14+
 * (API 34) для FGS, использующих RECORD_AUDIO.
 *
 * Завершается:
 *  - явный stopSelf() из Dart через background channel (durationSec истёк / parent stop / ошибка)
 *  - явный ACTION_STOP intent из MainActivity (ответ на STOP_AUDIO команду)
 *  - START_NOT_STICKY: если процесс убит OEM, не пытаемся перезапускаться
 *    (новая START_AUDIO команда от backend поднимет заново)
 */
class SoundAroundService : Service() {

    companion object {
        private const val TAG = "sound"
        private const val NOTIFICATION_ID = 4711
        private const val NOTIFICATION_CHANNEL_ID = "gmd_sound_around"
        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_TURN_CREDS_JSON = "turnCredsJson"
        const val EXTRA_DURATION_SEC = "durationSec"
        const val ACTION_STOP = "ru.link28rus.gmd.child.ACTION_SOUND_AROUND_STOP"

        private const val DART_LIBRARY_URI =
            "package:gmd_child/features/sound_around/sound_around_entry.dart"
        private const val DART_ENTRYPOINT = "soundAroundEntryPoint"
        private const val BG_CHANNEL = "gmd.child/sound_around_bg"
    }

    private var flutterEngine: FlutterEngine? = null
    private var bgChannel: MethodChannel? = null

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
        log("onStartCommand action=${intent?.action}")
        if (intent?.action == ACTION_STOP) {
            log("ACTION_STOP received")
            stopServiceCleanup()
            return START_NOT_STICKY
        }

        startForegroundCompat()

        val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID).orEmpty()
        val turnCredsJson = intent?.getStringExtra(EXTRA_TURN_CREDS_JSON).orEmpty()
        val durationSec = intent?.getIntExtra(EXTRA_DURATION_SEC, 300) ?: 300

        if (sessionId.isEmpty() || turnCredsJson.isEmpty()) {
            log("start without sessionId/turnCreds — bail")
            stopServiceCleanup()
            return START_NOT_STICKY
        }

        startFlutterEngine(sessionId, turnCredsJson, durationSec)
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        log("onTaskRemoved → stop")
        stopServiceCleanup()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        log("onDestroy")
        flutterEngine?.destroy()
        flutterEngine = null
        bgChannel = null
        super.onDestroy()
    }

    private fun startFlutterEngine(sessionId: String, turnCredsJson: String, durationSec: Int) {
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
                        val reason = call.argument<String>("reason") ?: "unknown"
                        log("Dart requested stop: $reason")
                        stopServiceCleanup()
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
                    "turnCredsJson" to turnCredsJson,
                    "durationSec" to durationSec,
                ),
            )

            flutterEngine = engine
            bgChannel = channel
            log("startFlutterEngine OK")
        } catch (e: Throwable) {
            logErr("startFlutterEngine FAILED", e)
            stopServiceCleanup()
        }
    }

    private fun stopServiceCleanup() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
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
     * System privacy indicator (зелёная точка) появится автоматически при
     * захвате микрофона — это by design Android, обойти нельзя.
     */
    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("gmd")
            .setContentText("Сервис активен")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }
}
