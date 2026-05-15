package ru.link28rus.gmd.gmd_parent

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

private const val DIAG_METHOD_CHANNEL = "ru.link28rus.gmd.parent/diag"

class MainActivity : FlutterActivity() {
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
        // Самопальный installer-channel удалён в v0.50.4 (lesson #24:
        // RuStore модерация запретила REQUEST_INSTALL_PACKAGES). Auto-update
        // через `flutter_rustore_update` SDK — см. lib/core/updates/.
    }
}
