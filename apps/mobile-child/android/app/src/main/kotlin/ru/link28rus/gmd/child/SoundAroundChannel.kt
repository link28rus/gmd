package ru.link28rus.gmd.child

import android.content.Context
import android.content.Intent
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * Хелпер регистрации `gmd.child/sound_around` MethodChannel.
 *
 * Регистрируется в ДВУХ Flutter engine'ах:
 *   1. UI-engine (MainActivity.configureFlutterEngine) — когда приложение открыто
 *      пользователем.
 *   2. Background engine (LocationForegroundService.ensureBackgroundEngine) —
 *      headless Dart isolate с location_ingestor.dart. Именно он обрабатывает
 *      START_AUDIO команды в фоне. Без регистрации канала в этом engine — вызов
 *      `MethodChannel('gmd.child/sound_around').invokeMethod('start', ...)`
 *      из Dart падает с MissingPluginException и команда не доходит до
 *      нативного SoundAroundService.
 *
 * См. commit 04cdaee / Plan E E2E v0.34.2 — MissingPluginException в
 * background poll обнаружился 2026-04-24 при первом реальном прогоне.
 *
 * v0.35: WebRTC-обёртка убрана. `start` теперь принимает sessionId + wsUrl
 * (URL уже содержит query с role/sessionId/token, выданный backend'ом в
 * payload START_AUDIO команды). `deliverAnswer` удалён — больше нет
 * AUDIO_ANSWER device-команды.
 */
object SoundAroundChannel {
    const val NAME = "gmd.child/sound_around"

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
                        "start: sessionId=${sessionId.take(8)}… durationSec=$durationSec",
                    )
                    val intent = Intent(appContext, SoundAroundService::class.java).apply {
                        putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
                        putExtra(SoundAroundService.EXTRA_WS_URL, wsUrl)
                        putExtra(SoundAroundService.EXTRA_DURATION_SEC, durationSec)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        appContext.startForegroundService(intent)
                    } else {
                        appContext.startService(intent)
                    }
                    result.success(null)
                }
                "stop" -> {
                    DiagLog.write(appContext, "sound_around", "stop requested from Dart")
                    val intent = Intent(appContext, SoundAroundService::class.java).apply {
                        action = SoundAroundService.ACTION_STOP
                    }
                    appContext.startService(intent)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }
}
