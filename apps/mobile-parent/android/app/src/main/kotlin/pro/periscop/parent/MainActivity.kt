package pro.periscop.parent

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

private const val DIAG_METHOD_CHANNEL = "pro.periscop.parent/diag"

class MainActivity : FlutterActivity() {
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
        // v0.56.0: самообновление с собственного сервера (AppUpdater.kt).
        AppUpdater.registerChannel(this, flutterEngine.dartExecutor.binaryMessenger)
    }
}
