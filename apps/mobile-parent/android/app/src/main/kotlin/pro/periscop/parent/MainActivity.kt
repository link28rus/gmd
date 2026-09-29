package pro.periscop.parent

import android.content.Intent
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.TimeZone

private const val DIAG_METHOD_CHANNEL = "pro.periscop.parent/diag"

// v0.66.0: сведения об устройстве (пояс для расписания и срока геозон).
private const val DEVICE_METHOD_CHANNEL = "pro.periscop.parent/device"

// v0.66.0: переход из уведомления. getInitialPush — extras стартового интента
// (один раз), onPush — из onNewIntent, когда приложение уже открыто.
private const val PUSH_METHOD_CHANNEL = "pro.periscop.parent/push"

class MainActivity : FlutterActivity() {
    companion object {
        // Extras уведомления — их кладёт ParentFirebaseMessagingService.
        const val EXTRA_FCM_TYPE = "fcm_type"
        const val EXTRA_CHILD_ID = "deeplink_child_id"
        const val EXTRA_ZONE_ID = "zone_id"

        /** Extras уведомления → map для Dart; null, если интент не из уведомления. */
        fun pushExtras(intent: Intent?): Map<String, String>? {
            val type = intent?.getStringExtra(EXTRA_FCM_TYPE)?.takeIf { it.isNotBlank() }
                ?: return null
            val out = mutableMapOf("type" to type)
            intent.getStringExtra(EXTRA_CHILD_ID)?.takeIf { it.isNotBlank() }
                ?.let { out["childId"] = it }
            intent.getStringExtra(EXTRA_ZONE_ID)?.takeIf { it.isNotBlank() }
                ?.let { out["zoneId"] = it }
            return out
        }
    }

    private var pushChannel: MethodChannel? = null

    /** Push стартового интента; отдаётся в Dart один раз. */
    private var initialPush: Map<String, String>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // До super.onCreate: там же вызывается configureFlutterEngine. Повторное
        // создание Activity (поворот, восстановление после смерти процесса) и
        // запуск из «Недавних» со старым интентом — не новый тап по уведомлению.
        val fromHistory = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (savedInstanceState == null && !fromHistory) {
            initialPush = pushExtras(intent)
        }
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val push = pushExtras(intent) ?: return
        pushChannel?.invokeMethod("onPush", push)
    }

    // v0.56.0: AppUpdater не ставит обновление в фоне, пока UI на экране, —
    // установка закрыла бы приложение под пальцем.
    override fun onResume() {
        super.onResume()
        AppUpdater.uiVisible = true
    }

    override fun onPause() {
        AppUpdater.uiVisible = false
        super.onPause()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DIAG_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "read" -> result.success(DiagLog.readAll(this))
                    "clear" -> {
                        DiagLog.clear(this)
                        result.success(null)
                    }
                    "write" -> {
                        val tag = call.argument<String>("tag") ?: "dart"
                        val msg = call.argument<String>("msg") ?: ""
                        DiagLog.write(this, tag, msg)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DEVICE_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    // IANA-пояс телефона («Asia/Vladivostok») — без нового пакета.
                    "timeZone" -> result.success(TimeZone.getDefault().id)
                    else -> result.notImplemented()
                }
            }
        pushChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PUSH_METHOD_CHANNEL)
            .also { ch ->
                ch.setMethodCallHandler { call, result ->
                    when (call.method) {
                        "getInitialPush" -> {
                            val push = initialPush
                            initialPush = null
                            result.success(push)
                        }
                        else -> result.notImplemented()
                    }
                }
            }
        // v0.56.0: самообновление с собственного сервера (AppUpdater.kt).
        AppUpdater.registerChannel(this, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        pushChannel?.setMethodCallHandler(null)
        pushChannel = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
