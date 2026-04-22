package ru.link28rus.gmd.child

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
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

class MainActivity : FlutterActivity() {
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
                        // управлять устройством». Текст explanation показывается
                        // пользователю как обоснование. Результат деактивации/активации
                        // получаем не здесь (диалог асинхронный) — Dart опрашивает
                        // isActive после возврата на экран приложения.
                        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
                            .putExtra(
                                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                                "Родительский контроль gmd: защищает приложение от случайного удаления ребёнком. Отключение возможно только через кабинет родителя."
                            )
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        DiagLog.write(this, "admin", "requestActivation: intent started")
                        result.success(null)
                    }
                    "openSettings" -> {
                        // Фоллбек: открыть системный экран списка Device Admin'ов
                        // (например для деактивации админа вручную, только сценарий
                        // отладки — пользователю показывать не надо).
                        val intent = Intent("android.app.action.SET_NEW_PASSWORD")
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
