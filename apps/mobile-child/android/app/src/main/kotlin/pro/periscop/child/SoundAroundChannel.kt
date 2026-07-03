package pro.periscop.child

import android.content.Context
import android.content.Intent
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * Хелпер регистрации `pro.periscop.child/sound_around` MethodChannel.
 *
 * Регистрируется в ДВУХ Flutter engine'ах:
 *   1. UI-engine (MainActivity.configureFlutterEngine) — когда приложение открыто
 *      пользователем.
 *   2. Background engine (LocationForegroundService.ensureBackgroundEngine) —
 *      headless Dart isolate с location_ingestor.dart. Именно он обрабатывает
 *      START_AUDIO команды в фоне. Без регистрации канала в этом engine — вызов
 *      `MethodChannel('pro.periscop.child/sound_around').invokeMethod('start', ...)`
 *      из Dart падает с MissingPluginException.
 *
 * v0.36.0 D-lite:
 *   `start` отправляет MODE_STREAM в SoundAroundService через простой startService
 *   (НЕ startForegroundService — service уже в FGS=microphone state благодаря
 *   pre-warm в MainActivity.onCreate). Trampoline через AlarmManager убран —
 *   на Android 14 он не давал mic-exemption, см. PoC v0.35.0-rc.7.
 *
 *   Если pre-warm не был сделан (например boot до открытия app) — startService
 *   создаст service, и handleStream попытается startForeground(type=MICROPHONE)
 *   из background context, что закрашится с SecurityException. Это известное
 *   ограничение, документировано пользователю в onboarding: «открой приложение
 *   хотя бы один раз после ребута, чтобы Звук вокруг работал в фоне».
 *
 * `stop` — переход в STOP_STREAM (service остаётся в FGS=prewarm для следующего использования).
 */
object SoundAroundChannel {
    const val NAME = "pro.periscop.child/sound_around"

    fun register(context: Context, messenger: BinaryMessenger) {
        val appContext = context.applicationContext
        MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    val sessionId = call.argument<String>("sessionId") ?: ""
                    val wsUrl = call.argument<String>("wsUrl") ?: ""
                    val durationSec = call.argument<Int>("durationSec") ?: 300

                    DiagLog.write(
                        appContext,
                        "sound_around",
                        "start (mode=stream): sessionId=${sessionId.take(8)}… durationSec=$durationSec",
                    )

                    val intent = Intent(appContext, SoundAroundService::class.java).apply {
                        putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STREAM)
                        putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
                        putExtra(SoundAroundService.EXTRA_WS_URL, wsUrl)
                        putExtra(SoundAroundService.EXTRA_DURATION_SEC, durationSec)
                    }
                    // startService (не startForegroundService): service уже в FGS state благодаря
                    // prewarm. Если ещё не prewarmed — handleStream сам сделает startForeground
                    // (что crashes из background, но это user-error «не открыл приложение»).
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            // startForegroundService обязателен на API 26+ для запуска
                            // background service'а. Если service уже в FGS — это просто
                            // деливерит intent в существующий, без нового foregroundCount.
                            appContext.startForegroundService(intent)
                        } else {
                            appContext.startService(intent)
                        }
                    } catch (e: Throwable) {
                        DiagLog.write(
                            appContext,
                            "sound_around",
                            "start failed: ${e.javaClass.simpleName}: ${e.message}",
                        )
                    }
                    result.success(null)
                }
                "stop" -> {
                    DiagLog.write(appContext, "sound_around", "stop (mode=stop_stream) requested from Dart")
                    val intent = Intent(appContext, SoundAroundService::class.java).apply {
                        putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_STOP_STREAM)
                    }
                    try {
                        // startService (не Foreground) — service уже в FGS, intent просто доставляется.
                        appContext.startService(intent)
                    } catch (e: Throwable) {
                        DiagLog.write(
                            appContext,
                            "sound_around",
                            "stop failed: ${e.javaClass.simpleName}: ${e.message}",
                        )
                    }
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }
}
