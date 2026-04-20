package ru.link28rus.gmd.child

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        FlutterEngineCache.getInstance().put(LocationForegroundService.ENGINE_ID, flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LocationForegroundService.METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startService" -> {
                        val intent = Intent(this, LocationForegroundService::class.java)
                            .setAction(LocationForegroundService.ACTION_START)
                        if (android.os.Build.VERSION.SDK_INT >= 26) {
                            startForegroundService(intent)
                        } else {
                            startService(intent)
                        }
                        result.success(null)
                    }
                    "stopService" -> {
                        stopService(Intent(this, LocationForegroundService::class.java))
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ru.link28rus.gmd.child/device_admin")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "request" -> {
                        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                        val component = android.content.ComponentName(this, GmdDeviceAdminReceiver::class.java)
                        if (dpm.isAdminActive(component)) {
                            result.success("already")
                        } else {
                            val intent = Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                                .putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
                                .putExtra(android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                                    "Защита от удаления. Мама/папа получит уведомление, если ты попытаешься выключить.")
                            startActivity(intent)
                            result.success("requested")
                        }
                    }
                    "isActive" -> {
                        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                        result.success(dpm.isAdminActive(android.content.ComponentName(this, GmdDeviceAdminReceiver::class.java)))
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
