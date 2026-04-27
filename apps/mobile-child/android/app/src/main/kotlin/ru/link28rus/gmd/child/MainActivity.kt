package ru.link28rus.gmd.child

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
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
// v0.38: Phase 6.1 screen-time. Native helpers для UsageStatsManager + installed apps.
private const val APP_CONTROL_METHOD_CHANNEL = "ru.link28rus.gmd.child/app_control"
// v0.38 escape hatch: probe + status check + open uninstall.
private const val ESCAPE_METHOD_CHANNEL = "ru.link28rus.gmd.child/escape"

private const val REQUEST_CODE_ADD_ADMIN = 8101

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        // v0.38 Phase 6.1: при наличии device-token поднимаем periodic workers
        // (UsageStatsReportWorker 15-min + InstalledAppsReportWorker 24h +
        //  EscapeProbeWorker 1h).
        // Идемпотентно (KEEP-policy) — повторные вызовы безопасны. Если token
        // ещё не сохранён (первый запуск до claim'а) — workers запустятся
        // после saveNativeCreds через protection channel (см. ниже).
        try {
            if (!NativeCreds.getToken(this).isNullOrEmpty()) {
                AppControlScheduler.scheduleAll(this)
                // v0.38.0-rc.7: на каждом старте app триггерим one-time
                // installed-apps + usage runs. Это решает проблему когда
                // periodic worker'ы ушли в exponential backoff после серии 5xx —
                // periodic не сработает быстро, но ручной open-app сделает
                // мгновенный sync. UX: «открой app → через 30 сек данные в кабинете».
                AppControlScheduler.runInstalledAppsNow(this)
                AppControlScheduler.runUsageNow(this)
                // v0.39 Phase 6.2: на старте сразу подтянуть active-block + app-rules.
                // Без этого после рестарта app локальный BlockManager может
                // содержать устаревший state (например, родитель остановил блок
                // пока app был закрыт).
                AppControlScheduler.runBlockPollNow(this)
                // v0.38 escape hatch: на старте app сразу probe — если ребёнка
                // удалили пока приложение было закрыто, не ждём периодический час.
                // Фоновый thread, не блокирует UI.
                Thread {
                    try {
                        ChildEscapeOrchestrator.probe(this)
                    } catch (e: Throwable) {
                        DiagLog.write(this, "escape", "onCreate probe failed: ${e.message}")
                    }
                }.start()
            }
        } catch (e: Throwable) {
            DiagLog.write(this, "ui", "scheduleAll failed: ${e.javaClass.simpleName}: ${e.message}")
        }

        // v0.36.0 D-lite: pre-warm SoundAroundService в FGS=microphone idle state.
        // Activity visible = foreground = Android разрешает startForeground(type=MICROPHONE)
        // без SecurityException. После этого service остаётся жить, и START_AUDIO команды
        // из background isolate (poll-loop при locked screen) могут активировать AudioRecord
        // без нового FGS-старта (= без crash).
        // Идемпотентен: если service уже в FGS state — handlePrewarm = no-op.
        try {
            val prewarmIntent = Intent(this, SoundAroundService::class.java)
                .putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_PREWARM)
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(prewarmIntent)
            } else {
                startService(prewarmIntent)
            }
            DiagLog.write(this, "ui", "onCreate: SoundAroundService pre-warm dispatched")
        } catch (e: Throwable) {
            DiagLog.write(
                this,
                "ui",
                "onCreate: pre-warm SoundAroundService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }

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
                    "getCurrentProfile" -> {
                        // v0.31.2 — UI-индикатор текущего профиля (STILL/ACTIVE).
                        // Читаем из SharedPreferences, куда сервис пишет при каждом
                        // switchProfile. Если сервис ещё не стартовал — вернём UNKNOWN.
                        val prefs = getSharedPreferences(
                            LocationForegroundService.PREFS_NAME,
                            Context.MODE_PRIVATE,
                        )
                        val profile = prefs.getString(
                            LocationForegroundService.PREF_CURRENT_PROFILE,
                            LocationForegroundService.PROFILE_UNKNOWN,
                        )
                        result.success(profile)
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
                    "deactivate" -> {
                        // Ребёнок сам не может снять admin, но приложение-admin
                        // может отозвать себя (Android 2.2+). Вызывается когда
                        // родитель выключил тумблер защиты в кабинете.
                        if (dpm.isAdminActive(admin)) {
                            dpm.removeActiveAdmin(admin)
                            DiagLog.write(this, "admin", "deactivate: removeActiveAdmin() called")
                        }
                        result.success(null)
                    }
                    "setProtectionCache" -> {
                        val enabled = call.argument<Boolean>("enabled") ?: true
                        NativeCreds.setProtectionEnabled(this, enabled)
                        DiagLog.write(this, "native", "setProtectionCache: $enabled")
                        result.success(null)
                    }
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
                    "openAppDetailsSettings" -> {
                        // Карточка приложения в Settings. На MIUI/HyperOS тут
                        // в меню ⋮ лежит «Разрешить ограниченные настройки»,
                        // без которого sideload-APK не может активировать
                        // Device Admin (начиная с HyperOS 2 / MIUI 14+). На
                        // stock Android — просто App info.
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                            .setData(android.net.Uri.parse("package:$packageName"))
                        startActivity(intent)
                        result.success(null)
                    }
                    "deviceManufacturer" -> result.success(
                        android.os.Build.MANUFACTURER.lowercase()
                    )
                    "saveNativeCreds" -> {
                        val token = call.argument<String>("deviceToken")
                        val baseUrl = call.argument<String>("apiBaseUrl")
                        NativeCreds.save(this, token, baseUrl)
                        DiagLog.write(
                            this,
                            "native",
                            "saveNativeCreds: token=${token?.take(6)}… base=$baseUrl",
                        )
                        // v0.38 Phase 6.1: после claim'а запускаем periodic workers.
                        // Идемпотентно (KEEP) — если уже стояли, ничего не меняется.
                        if (!token.isNullOrEmpty()) {
                            try {
                                AppControlScheduler.scheduleAll(this)
                            } catch (e: Throwable) {
                                DiagLog.write(this, "native", "scheduleAll after creds failed: ${e.message}")
                            }
                        }
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }

        // gmd.child/sound_around — регистрируем через общий helper.
        // Тот же helper вызывается в LocationForegroundService для background isolate,
        // иначе POLL-команда START_AUDIO в фоне падает с MissingPluginException.
        SoundAroundChannel.register(this, flutterEngine.dartExecutor.binaryMessenger)

        // v0.38: Phase 6.1 screen-time channel. Только UI-isolate (worker'ы используют
        // AppControlNative напрямую через WorkManager — не через channel).
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, APP_CONTROL_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "hasUsageStatsPermission" ->
                        result.success(AppControlNative.hasUsageStatsPermission(this))
                    "openUsageStatsSettings" -> {
                        try {
                            AppControlNative.openUsageStatsSettings(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("open_settings_failed", e.message, null)
                        }
                    }
                    // v0.39 Phase 6.2: Accessibility helpers
                    "isAccessibilityServiceEnabled" ->
                        result.success(AppControlNative.isAccessibilityServiceEnabled(this))
                    "openAccessibilitySettings" -> {
                        try {
                            AppControlNative.openAccessibilitySettings(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("open_settings_failed", e.message, null)
                        }
                    }
                    "openAppDetailsSettings" -> {
                        try {
                            AppControlNative.openAppDetailsSettings(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("open_settings_failed", e.message, null)
                        }
                    }
                    // v0.39.5 Phase 6.2 fix: SAW для visual blocking overlay
                    "canDrawOverlays" ->
                        result.success(AppControlNative.canDrawOverlays(this))
                    "openOverlaySettings" -> {
                        try {
                            AppControlNative.openOverlaySettings(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("open_settings_failed", e.message, null)
                        }
                    }
                    "deviceTimezone" ->
                        result.success(AppControlNative.deviceTimezone())
                    "collectInstalledApps" -> {
                        // Тяжёлая операция (~100-500ms на типичном устройстве из-за
                        // PNG-кодирования иконок). Запускаем на background-thread,
                        // result уходит в Flutter после завершения.
                        Thread {
                            try {
                                val apps = AppControlNative.collectInstalledApps(this)
                                val payload = apps.map {
                                    mapOf(
                                        "packageName" to it.packageName,
                                        "appLabel" to it.appLabel,
                                        "isSystem" to it.isSystem,
                                        "iconSha256" to it.iconSha256,
                                        // ВНИМАНИЕ: pngBytes передаются как ByteArray, Flutter
                                        // получает Uint8List. Не base64 — экономим memcpy.
                                        "iconPngBytes" to it.iconPngBytes,
                                    )
                                }
                                runOnUiThread { result.success(payload) }
                            } catch (e: Throwable) {
                                runOnUiThread {
                                    result.error("collect_failed", e.message, null)
                                }
                            }
                        }.start()
                    }
                    "collectUsageBuckets" -> {
                        val daysBack = (call.argument<Int>("daysBack") ?: 1).coerceIn(1, 30)
                        Thread {
                            try {
                                val buckets = AppControlNative.collectUsageBuckets(this, daysBack)
                                val payload = buckets.map {
                                    mapOf(
                                        "date" to it.date,
                                        "hour" to it.hour,
                                        "packageName" to it.packageName,
                                        "seconds" to it.seconds,
                                    )
                                }
                                runOnUiThread { result.success(payload) }
                            } catch (e: Throwable) {
                                runOnUiThread {
                                    result.error("collect_failed", e.message, null)
                                }
                            }
                        }.start()
                    }
                    "scheduleAll" -> {
                        try {
                            AppControlScheduler.scheduleAll(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("schedule_failed", e.message, null)
                        }
                    }
                    "runUsageNow" -> {
                        try {
                            AppControlScheduler.runUsageNow(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("run_failed", e.message, null)
                        }
                    }
                    "runInstalledAppsNow" -> {
                        try {
                            AppControlScheduler.runInstalledAppsNow(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("run_failed", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }

        // v0.38 escape hatch channel.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, ESCAPE_METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isInEscapeMode" ->
                        result.success(ChildEscapeOrchestrator.isInEscapeMode(this))
                    "lastReason" ->
                        result.success(ChildEscapeOrchestrator.lastReason(this))
                    "probeNow" -> {
                        Thread {
                            try {
                                val r = ChildEscapeOrchestrator.probe(this)
                                runOnUiThread { result.success(r.name) }
                            } catch (e: Throwable) {
                                runOnUiThread { result.error("probe_failed", e.message, null) }
                            }
                        }.start()
                    }
                    "openAppDetails" -> {
                        try {
                            ChildEscapeOrchestrator.openAppDetails(this)
                            result.success(null)
                        } catch (e: Throwable) {
                            result.error("open_failed", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
