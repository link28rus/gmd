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
 *      пользователем. Плохо подходит для Plan B: команда START_AUDIO прилетает из
 *      background isolate при poll, UI-engine может даже не существовать.
 *   2. Background engine (LocationForegroundService.ensureBackgroundEngine) —
 *      headless Dart isolate с location_ingestor.dart. Именно он обрабатывает
 *      START_AUDIO команды в фоне. Без регистрации канала в этом engine — вызов
 *      `MethodChannel('gmd.child/sound_around').invokeMethod('start', ...)`
 *      из Dart падает с MissingPluginException и команда не доходит до
 *      нативного SoundAroundService.
 *
 * См. commit 04cdaee / Plan E E2E verification — MissingPluginException в
 * background poll обнаружился 2026-04-24 при первом реальном прогоне.
 */
object SoundAroundChannel {
    const val NAME = "gmd.child/sound_around"

    fun register(context: Context, messenger: BinaryMessenger) {
        val appContext = context.applicationContext
        MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    val sessionId = call.argument<String>("sessionId") ?: ""
                    @Suppress("UNCHECKED_CAST")
                    val turnCreds =
                        call.argument<Map<String, Any?>>("turnCreds") ?: emptyMap()
                    val durationSec = call.argument<Int>("durationSec") ?: 300

                    DiagLog.write(
                        appContext,
                        "sound_around",
                        "start: sessionId=${sessionId.take(8)}… durationSec=$durationSec",
                    )
                    val intent = Intent(appContext, SoundAroundService::class.java).apply {
                        putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
                        putExtra(
                            SoundAroundService.EXTRA_TURN_CREDS_JSON,
                            org.json.JSONObject(turnCreds).toString(),
                        )
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
                "deliverAnswer" -> {
                    val sessionId = call.argument<String>("sessionId") ?: ""
                    val sdp = call.argument<String>("sdp") ?: ""
                    val bg = SoundAroundService.sActiveBgChannel
                    if (bg != null) {
                        DiagLog.write(
                            appContext,
                            "sound_around",
                            "deliverAnswer → bgChannel: sessionId=${sessionId.take(8)}…",
                        )
                        bg.invokeMethod(
                            "applyAnswer",
                            mapOf("sessionId" to sessionId, "sdp" to sdp),
                        )
                        result.success(null)
                    } else {
                        DiagLog.write(
                            appContext,
                            "sound_around",
                            "deliverAnswer: NO_ACTIVE_FGS — ignoring answer",
                        )
                        result.error("NO_ACTIVE_FGS", "SoundAroundService not running", null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
