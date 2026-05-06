package ru.link28rus.gmd.gmd_parent

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

private const val DIAG_METHOD_CHANNEL = "ru.link28rus.gmd.parent/diag"
private const val INSTALLER_METHOD_CHANNEL = "ru.link28rus.gmd.parent/installer"

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

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, INSTALLER_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "canRequestInstall" ->
                        result.success(InstallerNative.canRequestInstall(this))
                    "openInstallSourceSettings" -> {
                        try {
                            InstallerNative.openInstallSourceSettings(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("open_settings_failed", e.message, null)
                        }
                    }
                    "installApk" -> {
                        val path = call.argument<String>("path")
                        if (path.isNullOrEmpty()) {
                            result.error("bad_arg", "path is required", null)
                            return@setMethodCallHandler
                        }
                        try {
                            val ok = InstallerNative.installApk(this, path)
                            result.success(ok)
                        } catch (e: Throwable) {
                            result.error("install_failed", e.message, null)
                        }
                    }
                    "cleanupCache" -> {
                        try {
                            InstallerNative.cleanupCache(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("cleanup_failed", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
