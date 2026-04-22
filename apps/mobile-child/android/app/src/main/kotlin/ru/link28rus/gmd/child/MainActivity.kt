package ru.link28rus.gmd.child

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// UI-Activity поднимает свой FlutterEngine под UI. Headless-engine фонового
// трекинга живёт отдельно в LocationForegroundService (кеш ID
// `gmd_bg_location_engine`), чтобы локации продолжали приходить после закрытия
// UI, убийства процесса системой и ребута (см. BootReceiver).
private const val UI_METHOD_CHANNEL = "ru.link28rus.gmd.child/location"
private const val DIAG_METHOD_CHANNEL = "ru.link28rus.gmd.child/diag"
private const val PROTECTION_METHOD_CHANNEL = "ru.link28rus.gmd.child/protection"

private const val REQUEST_CODE_ADD_ADMIN = 8101

class MainActivity : FlutterActivity() {
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_ADD_ADMIN) {
            DiagLog.write(this, "admin", "onActivityResult: ADD_DEVICE_ADMIN resultCode=$resultCode")
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, UI_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startService" -> {
                        DiagLog.write(this, "ui", "startService invoked from Dart")
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
                        DiagLog.write(this, "ui", "stopService invoked from Dart")
                        val intent = Intent(this, LocationForegroundService::class.java)
                            .setAction(LocationForegroundService.ACTION_STOP)
                        startService(intent)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DIAG_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "read" -> result.success(DiagLog.readAll(this))
                    "clear" -> {
                        DiagLog.clear(this)
                        result.success(null)
                    }
                    "write" -> {
                        val tag = (call.argument<String>("tag") ?: "dart")
                        val msg = (call.argument<String>("msg") ?: "")
                        DiagLog.write(this, tag, msg)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PROTECTION_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val admin = ChildDeviceAdminReceiver.componentName(this)
                when (call.method) {
                    "isActive" -> result.success(dpm.isAdminActive(admin))
                    "requestActivation" -> {
                        // Системный диалог подтверждения: «Разрешить этому приложению
                        // управлять устройством». Важно — НЕ ставим FLAG_ACTIVITY_NEW_TASK,
                        // т.к. intent запускается из существующей Activity (MainActivity
                        // c taskAffinity=""), и NEW_TASK на MIUI/HyperOS глушит systemui
                        // без видимого диалога. startActivityForResult даёт callback
                        // onActivityResult — UI дёргает invalidate провайдера.
                        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
                            .putExtra(
                                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                                "Родительский контроль gmd: защищает приложение от случайного удаления ребёнком. Отключение возможно только через кабинет родителя."
                            )
                        val resolved = intent.resolveActivity(packageManager)
                        DiagLog.write(
                            this,
                            "admin",
                            "requestActivation: resolved=${resolved?.flattenToShortString() ?: "null"}",
                        )
                        if (resolved != null) {
                            startActivityForResult(intent, REQUEST_CODE_ADD_ADMIN)
                            result.success(null)
                        } else {
                            // Fallback: некоторые прошивки не резолвят ACTION_ADD_DEVICE_ADMIN —
                            // открываем экран Device Administrators напрямую.
                            val settings = Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS)
                            startActivity(settings)
                            DiagLog.write(this, "admin", "requestActivation: fallback to security settings")
                            result.success(null)
                        }
                    }
                    "openSettings" -> {
                        val settings = Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS)
                        startActivity(settings)
                        result.success(null)
                    }
                    "isAccessibilityEnabled" -> result.success(isAccessibilityServiceEnabled())
                    "openAccessibilitySettings" -> {
                        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                        startActivity(intent)
                        result.success(null)
                    }
                    "saveNativeCreds" -> {
                        val token = call.argument<String>("deviceToken")
                        val baseUrl = call.argument<String>("apiBaseUrl")
                        NativeCreds.save(this, token, baseUrl)
                        DiagLog.write(
                            this,
                            "native",
                            "saveNativeCreds: token=${token?.take(6)}… base=$baseUrl",
                        )
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expected = ComponentName(this, GmdAccessibilityService::class.java)
            .flattenToString()
        val enabledStr = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':').also { it.setString(enabledStr) }
        while (splitter.hasNext()) {
            if (splitter.next().equals(expected, ignoreCase = true)) return true
        }
        // Fallback: сверить через AccessibilityManager, на случай OEM-разметки.
        val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        if (!am.isEnabled) return false
        val list = am.getEnabledAccessibilityServiceList(0) ?: return false
        return list.any { it.resolveInfo.serviceInfo.packageName == packageName }
    }
}
