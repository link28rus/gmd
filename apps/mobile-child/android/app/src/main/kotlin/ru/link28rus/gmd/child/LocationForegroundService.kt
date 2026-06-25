package ru.link28rus.gmd.child

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

class LocationForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "gmd_location_channel"
        const val NOTIF_ID = 0xC1
        const val METHOD_CHANNEL = "ru.link28rus.gmd.child/location"
        const val DIAG_CHANNEL = "ru.link28rus.gmd.child/diag"
        const val SIGNAL_CHANNEL = "ru.link28rus.gmd.child/signal"
        // Отдельный engine для headless-изолята фонового сервиса. UI-Activity
        // держит свой engine через FlutterActivity — они не пересекаются.
        const val BG_ENGINE_ID = "gmd_bg_location_engine"
        const val DART_ENTRYPOINT = "locationEntryPoint"
        const val DART_LIBRARY_URI = "package:gmd_child/background/location_entry.dart"
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val ACTION_HEARTBEAT = "ACTION_HEARTBEAT"
        // Activity Recognition transitions — шлются ActivityTransitionReceiver'ом
        // в этот сервис через startForegroundService(intent).
        const val ACTION_ACTIVITY_STILL = "ACTION_ACTIVITY_STILL"
        const val ACTION_ACTIVITY_MOVING = "ACTION_ACTIVITY_MOVING"
        private const val WAKE_LOCK_TAG = "gmd:LocationForegroundService"
        // Heartbeat — гарантированная точка раз в 90 секунд, даже если телефон
        // неподвижен и fused с distance-filter 30м не присылает обновлений.
        // Родитель в web видит "Был тут только что" независимо от движения.
        // Также именно heartbeat-точка даёт нам speed → детектим начало движения
        // в STILL-режиме без ожидания Activity Recognition (см. v0.40.1).
        // Реализовано через AlarmManager (не Handler), чтобы MIUI не замораживал
        // тики после свайпа — см. HeartbeatReceiver.
        private const val HEARTBEAT_INTERVAL_MS = 90 * 1000L
        private const val HEARTBEAT_ALARM_REQUEST = 0x48
        private const val ACTIVITY_REQUEST_CODE = 0x49

        // v0.31.0 — фильтрация GPS-шума. Пороги подобраны под типичный
        // indoor-multipath (accuracy 30-80м при физически неподвижном телефоне):
        //
        //   ACCURACY_GATE_M        — жёсткий фильтр при обычных апдейтах.
        //                            Точки с worse accuracy не доходят до Dart.
        //   ACCURACY_GATE_HEARTBEAT_M — более мягкий для heartbeat (раз в 2 мин).
        //                               Приоритет «жив» > чистоты трека.
        //   DEDUP_MIN_DIST_M       — минимальное перемещение от прошлой точки.
        //   DEDUP_WINDOW_MS        — окно, в рамках которого работает dedup.
        //                            Старше — всегда пропускаем (чтобы heartbeat
        //                            не глушил реально свежую точку после паузы).
        private const val ACCURACY_GATE_M = 75f
        private const val ACCURACY_GATE_HEARTBEAT_M = 100f
        private const val DEDUP_MIN_DIST_M = 30f
        private const val DEDUP_WINDOW_MS = 60_000L

        // v0.41.1 — отдельный gate для точек без speed.
        // Эмпирика на проде (Артём, 28 апреля): из 25 точек 2 outlier'а имели
        // hasSpeed()=false (acc=13м и 26м, обе через Wi-Fi MLS — wifiSsid="link28rus5G"
        // у одной, network="mobile" у другой), все 23 нормальные GPS-точки имели speed.
        // FLP не различает GPS vs network на уровне provider="fused", но отсутствие
        // speed — надёжный сигнал что fix получен через positioning service, не GPS.
        // Такие точки могут иметь "уверенно низкую" accuracy (10-30м) при физическом
        // смещении 30-100м — основная причина "отдельных точек" на треке.
        private const val ACCURACY_GATE_NO_SPEED_M = 10f
        // Порог для requestFreshLocationOnce при wake-on-motion. Если первая
        // точка после пробуждения хуже — лучше дропнуть и подождать FLP-callback
        // (5 сек с PRIORITY_HIGH_ACCURACY), чем нарисовать "прыжок".
        private const val FRESH_LOCATION_MAX_ACCURACY_M = 30f

        // Два профиля апдейтов FLP:
        //   ACTIVE — ребёнок движется (по speed > SPEED_MOVING_MS либо AR=MOVING).
        //            Плотный трек: 5 сек / 10 м, PRIORITY_HIGH_ACCURACY → каждые
        //            ~10-15м точка при езде 50 км/ч, дороги выглядят как дороги.
        //   STILL  — телефон неподвижен дольше STILL_DEBOUNCE_MS. Сильно реже,
        //            но не настолько как раньше — 60 сек / 30 м: если ребёнок
        //            побежал/поехал, мы заметим speed > 2 м/с уже на следующем
        //            FLP-апдейте (не ждать AR transition'а 30-90 сек).
        //
        // v0.40.1: переключение профилей теперь не только по AR, но и по speed
        // в самих location callback'ах (см. maybeAutoSwitchProfile). AR медленный
        // на старт движения — пропускались первые 1-2 км трека.
        private const val ACTIVE_INTERVAL_MS = 5_000L
        private const val ACTIVE_MIN_DIST_M = 10f
        private const val STILL_INTERVAL_MS = 60_000L
        private const val STILL_MIN_DIST_M = 30f

        // Speed-based fast switch (v0.40.1).
        //   SPEED_MOVING_MS         — выше этого считаем "точно движется"
        //                              (~7 км/ч, выше скорости walk-noise).
        //   SPEED_STILL_MS          — ниже этого "точно стоит".
        //   STILL_DEBOUNCE_MS       — сколько подряд должно быть STILL-точек
        //                              чтобы переключиться обратно в STILL.
        //
        // v0.40.2: debounce поднят с 90 секунд до 15 минут. Раньше дёргались в
        // STILL после каждого светофора (1-2 мин стоянки) и теряли качество
        // следующего перегона (одна точка вместо плотного трека). Теперь:
        //   - светофор/пробка/магазин (1-15 мин) → остаёмся ACTIVE → плотный
        //     трек продолжается без разрывов
        //   - реальная стоянка (дом, школа на уроках, парковка >15 мин) →
        //     переходим в STILL → батарея экономится
        // Trade-off: расход батареи в режиме «гулял по двору 30 минут» вырастет
        // (~+1-2%/час), но трек будет читаемый — плавный, без разрывов.
        private const val SPEED_MOVING_MS = 2.0f
        private const val SPEED_STILL_MS = 0.5f
        private const val STILL_DEBOUNCE_MS = 15 * 60_000L

        // v0.31.2 — текущий профиль экспозится Dart-стороне через SharedPreferences.
        // UI-engine читает эти prefs через MainActivity MethodChannel и рендерит
        // chip-индикатор на home-экране ребёнка.
        const val PREFS_NAME = "gmd_location_state"
        const val PREF_CURRENT_PROFILE = "current_profile"
        const val PROFILE_ACTIVE = "ACTIVE"
        const val PROFILE_STILL = "STILL"
        const val PROFILE_UNKNOWN = "UNKNOWN"
    }

    private lateinit var fused: FusedLocationProviderClient
    private var callback: LocationCallback? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var bgEngine: FlutterEngine? = null
    private var bgChannel: MethodChannel? = null

    // v0.40.3 — Hardware motion sensor для wake-on-motion в STILL-режиме.
    // Lazy чтобы applicationContext был готов (создаётся в onCreate).
    // Callback дёргает forced switch STILL → ACTIVE при первом event'е.
    private val motionMonitor: MotionSensorMonitor by lazy {
        MotionSensorMonitor(applicationContext) {
            log("motion sensor TRIGGERED (${motionMonitor.sensorLabel}) → forced ACTIVE")
            onMotionSensorTriggered()
        }
    }

    // Профиль апдейтов FLP. Переключается intent-ами от ActivityTransitionReceiver.
    // Default=ACTIVE: если permission ACTIVITY_RECOGNITION не дан, сервис никогда
    // не получит STILL-сигнал и будет жить в active-профиле — это ок, accuracy-gate
    // всё равно отфильтрует indoor-мусор.
    private enum class Profile { ACTIVE, STILL }
    private var profile: Profile = Profile.ACTIVE

    // Последняя реально отправленная в Dart точка — для stationary-dedup.
    // Не путать с fused.lastLocation (FLP-cache) — тут только то, что прошло
    // наши фильтры.
    private var lastSentLat: Double? = null
    private var lastSentLon: Double? = null
    private var lastSentTimeMs: Long = 0L

    // v0.40.1: время последнего "движущегося" speed (≥ SPEED_MOVING_MS).
    // Если 0 — ни разу не двигались с момента старта сервиса.
    // Используется в [maybeAutoSwitchProfile] для STILL→ACTIVE и ACTIVE→STILL
    // быстрее чем Activity Recognition transitions (которые лагают 30-90с).
    private var lastMovingTimeMs: Long = 0L

    private fun log(msg: String) = DiagLog.write(this, "svc", msg)
    private fun logErr(msg: String, e: Throwable) =
        DiagLog.write(this, "svc", "$msg: ${e.javaClass.simpleName}: ${e.message}")

    override fun onCreate() {
        super.onCreate()
        log("onCreate")
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
        ensureBackgroundEngine()
        // v0.50.4 (lesson #24): UpdateCheckScheduler удалён — auto-update
        // полностью через `flutter_rustore_update` SDK на Dart-слое.
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        log("onStartCommand action=${intent?.action} flags=$flags startId=$startId")
        when (intent?.action) {
            ACTION_STOP -> {
                cancelHeartbeatAlarm()
                unregisterActivityTransitions()
                motionMonitor.stop()
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_HEARTBEAT -> {
                // AlarmManager разбудил нас — нужен promote в foreground,
                // иначе на Android 12+ startForegroundService без startForeground
                // в 5 сек = ANR. Если сервис уже живой, повторный startForeground
                // безопасен.
                startForeground(NOTIF_ID, buildNotification())
                handleHeartbeat()
                // Перепланируем следующий alarm — делаем это всегда, в т.ч.
                // после ошибок lastLocation, иначе цепочка оборвётся.
                scheduleHeartbeatAlarm()
            }
            ACTION_ACTIVITY_STILL -> {
                // Activity Recognition сигналит «ребёнок неподвижен» →
                // переключаем FLP в still-профиль (interval=5мин, minDist=50м).
                // Сервис может быть ещё не started — promote в foreground
                // безопасен и идемпотентен.
                startForeground(NOTIF_ID, buildNotification())
                switchProfile(Profile.STILL)
            }
            ACTION_ACTIVITY_MOVING -> {
                startForeground(NOTIF_ID, buildNotification())
                switchProfile(Profile.ACTIVE)
            }
            else -> start()
        }
        return START_STICKY
    }

    // Отдельный метод для heartbeat-тика, вызывается только из AlarmManager
    // через HeartbeatReceiver → onStartCommand(ACTION_HEARTBEAT).
    private fun handleHeartbeat() {
        log("heartbeat tick (from AlarmManager)")
        try {
            fused.lastLocation
                .addOnSuccessListener { loc ->
                    if (loc != null) {
                        log("heartbeat: got last location, sending (heartbeat-mode)")
                        sendToDart(loc, heartbeat = true)
                    } else {
                        log("heartbeat: lastLocation is null — provider has no cached fix yet")
                    }
                }
                .addOnFailureListener { e -> logErr("heartbeat lastLocation failed", e) }
        } catch (e: SecurityException) {
            logErr("heartbeat lastLocation SecurityException", e)
        }
    }

    private fun scheduleHeartbeatAlarm() {
        try {
            val pi = PendingIntent.getBroadcast(
                this,
                HEARTBEAT_ALARM_REQUEST,
                Intent(this, HeartbeatReceiver::class.java)
                    .setAction(HeartbeatReceiver.ACTION_HEARTBEAT),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val triggerAt = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS
            val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                am.canScheduleExactAlarms()
            } else true
            if (canExact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                log("heartbeat alarm scheduled (exact) in ${HEARTBEAT_INTERVAL_MS / 1000}s")
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                log("heartbeat alarm scheduled (inexact) in ${HEARTBEAT_INTERVAL_MS / 1000}s")
            }
        } catch (e: Throwable) {
            logErr("heartbeat alarm schedule failed", e)
        }
    }

    private fun cancelHeartbeatAlarm() {
        try {
            val pi = PendingIntent.getBroadcast(
                this,
                HEARTBEAT_ALARM_REQUEST,
                Intent(this, HeartbeatReceiver::class.java)
                    .setAction(HeartbeatReceiver.ACTION_HEARTBEAT),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pi)
        } catch (_: Throwable) {
            // ignore
        }
    }

    private fun ensureBackgroundEngine() {
        if (bgEngine != null) {
            log("ensureBackgroundEngine: already have engine")
            return
        }
        val cached = FlutterEngineCache.getInstance().get(BG_ENGINE_ID)
        if (cached != null) {
            log("ensureBackgroundEngine: using cached engine")
            bgEngine = cached
            bgChannel = MethodChannel(cached.dartExecutor.binaryMessenger, METHOD_CHANNEL)
            return
        }

        log("ensureBackgroundEngine: creating new headless engine")
        try {
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(applicationContext)
            loader.ensureInitializationComplete(applicationContext, null)

            val engine = FlutterEngine(applicationContext)
            // КРИТИЧНО: при ручном создании FlutterEngine (не через FlutterActivity) плагины
            // НЕ регистрируются автоматически. Без этого вызова в headless-изоляте все
            // MethodChannel'ы (path_provider / flutter_secure_storage / sqlite3_flutter_libs /
            // connectivity_plus) падают с MissingPluginException и ingestor молча умирает.
            GeneratedPluginRegistrant.registerWith(engine)
            log("ensureBackgroundEngine: plugins registered, starting Dart entrypoint")
            val entrypoint = DartExecutor.DartEntrypoint(
                loader.findAppBundlePath(),
                DART_LIBRARY_URI,
                DART_ENTRYPOINT,
            )
            engine.dartExecutor.executeDartEntrypoint(entrypoint)
            FlutterEngineCache.getInstance().put(BG_ENGINE_ID, engine)

            bgEngine = engine
            bgChannel = MethodChannel(engine.dartExecutor.binaryMessenger, METHOD_CHANNEL)

            // Диагностический канал для headless-Dart: принимает diagLog('bg', 'msg').
            MethodChannel(engine.dartExecutor.binaryMessenger, DIAG_CHANNEL)
                .setMethodCallHandler { call, result ->
                    when (call.method) {
                        "write" -> {
                            val tag = call.argument<String>("tag") ?: "bg"
                            val msg = call.argument<String>("msg") ?: ""
                            DiagLog.write(applicationContext, tag, msg)
                            result.success(null)
                        }
                        else -> result.notImplemented()
                    }
                }

            // Канал сигнала — Dart (ingestor) вызывает play при PLAY_SIGNAL
            // команде с сервера. Запускаем отдельный SignalSoundService с
            // foregroundServiceType=mediaPlayback, чтобы он не зависел от
            // нашего жизненного цикла и корректно переживал Doze.
            MethodChannel(engine.dartExecutor.binaryMessenger, SIGNAL_CHANNEL)
                .setMethodCallHandler { call, result ->
                    when (call.method) {
                        "play" -> {
                            log("signal.play invoked from Dart")
                            val intent = Intent(applicationContext, SignalSoundService::class.java)
                                .setAction(SignalSoundService.ACTION_PLAY)
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                applicationContext.startForegroundService(intent)
                            } else {
                                applicationContext.startService(intent)
                            }
                            result.success(null)
                        }
                        else -> result.notImplemented()
                    }
                }

            // gmd.child/sound_around — тот же канал что и в MainActivity.
            // Без него команда START_AUDIO из background poll'а падает с
            // MissingPluginException (Plan E bugfix 2026-04-24).
            SoundAroundChannel.register(applicationContext, engine.dartExecutor.binaryMessenger)

            log("ensureBackgroundEngine: OK, channel ready")
        } catch (e: Throwable) {
            logErr("ensureBackgroundEngine FAILED", e)
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
            setReferenceCounted(false)
            // Без таймаута: держим пока service жив. Отпускаем в onDestroy / ACTION_STOP.
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    private fun start() {
        log("start()")
        // v0.50.2 — permission gate. На Android 14+ (targetSdk=34) startForeground
        // с FGS_TYPE_LOCATION требует granted ACCESS_*_LOCATION, иначе
        // ActivityThread бросает SecurityException и процесс крашится. Это
        // ловит свежеустановленные устройства (claim flow ещё не пройден,
        // permissions ещё не запрошены). BootReceiver уже гейтит, но сервис
        // может быть стартован и из других точек (FCM message handler,
        // MainActivity), поэтому дублируем защиту здесь.
        if (!hasLocationPermission()) {
            log("start: SKIPPED (no ACCESS_*_LOCATION permission); stopSelf")
            stopSelf()
            return
        }
        startForeground(NOTIF_ID, buildNotification())
        acquireWakeLock()
        ensureBackgroundEngine()
        if (callback != null) {
            log("start: callback already subscribed, skip requestLocationUpdates")
            return
        }
        // v0.31.2 — STILL-default: если permission granted, стартуем
        // сразу в экономичном режиме. Если permission нет, AR никогда не
        // пришлёт MOVING_ENTER и мы застрянем в STILL → стартуем в ACTIVE.
        val initial = if (hasActivityRecognitionPermission()) Profile.STILL else Profile.ACTIVE
        log("start: initial profile = $initial (AR permission = ${hasActivityRecognitionPermission()})")
        // v0.40.3 — сразу логируем доступность motion sensor, чтобы при анализе
        // DiagLog'а понимать почему wake-on-motion работает / не работает на
        // конкретном устройстве.
        log("start: motion sensor support: ${motionMonitor.sensorLabel} (supported=${motionMonitor.isSupported})")
        profile = initial
        persistProfile(initial)
        subscribeLocationUpdates(initial)
        // Если стартуем в STILL — сразу регистрируем motion sensor для wake-on-motion.
        // (switchProfile сделает то же самое при переключении, но при первом
        // start() мы не вызываем switchProfile, поэтому делаем явно здесь.)
        if (initial == Profile.STILL) {
            val ok = motionMonitor.start()
            log("start: motion sensor register=$ok (initial STILL)")
        }
        // Heartbeat: шлём текущую точку раз в 2 минуты через AlarmManager.
        // Ставим даже если повторный start() — PendingIntent с одним requestCode
        // идемпотентен (replace-semantics), лишнего alarm'а не будет.
        scheduleHeartbeatAlarm()
        // Активируем Activity Recognition. Если permission не дан — тихо логируем
        // и живём в ACTIVE-режиме (accuracy-gate работает всегда).
        registerActivityTransitions()
    }

    private fun hasActivityRecognitionPermission(): Boolean {
        // Pre-Android-10 permission не существует в runtime-модели, считаем granted.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    // v0.50.2 — проверка location permission'ов (любого из двух). Используется
    // в [start] чтобы не падать с SecurityException при startForeground для
    // FGS_TYPE_LOCATION без granted permission. См. также BootReceiver.
    private fun hasLocationPermission(): Boolean {
        return checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun persistProfile(p: Profile) {
        try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_CURRENT_PROFILE, when (p) {
                    Profile.ACTIVE -> PROFILE_ACTIVE
                    Profile.STILL -> PROFILE_STILL
                })
                .apply()
        } catch (e: Throwable) {
            logErr("persistProfile failed", e)
        }
    }

    // Подписка на FLP с профилем-параметром. Переиспользуется при switchProfile.
    private fun subscribeLocationUpdates(p: Profile) {
        val (interval, minDist, priority) = when (p) {
            // ACTIVE = ребёнок реально движется (по speed или AR=MOVING).
            // HIGH_ACCURACY включает GPS на полную — это критично, чтобы трек
            // на дороге был плотным (~10-15 м между точками на 50 км/ч).
            // Расход батареи compensируется коротким временем в этом профиле.
            Profile.ACTIVE -> Triple(ACTIVE_INTERVAL_MS, ACTIVE_MIN_DIST_M, Priority.PRIORITY_HIGH_ACCURACY)
            // STILL = телефон неподвижен. BALANCED не включает GPS на полную,
            // больше опирается на Wi-Fi/cell — экономит батарею в помещении.
            // Indoor multipath GPS-шум тоже отсекается (accuracy gate работает).
            Profile.STILL -> Triple(STILL_INTERVAL_MS, STILL_MIN_DIST_M, Priority.PRIORITY_BALANCED_POWER_ACCURACY)
        }
        val request = LocationRequest.Builder(priority, interval)
            .setMinUpdateDistanceMeters(minDist)
            .setMinUpdateIntervalMillis(interval / 2)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                log("onLocationResult size=${result.locations.size} profile=$p")
                for (loc in result.locations) {
                    sendToDart(loc, heartbeat = false)
                }
            }
        }
        callback = cb
        try {
            fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
            log("requestLocationUpdates OK profile=$p interval=${interval}ms minDist=${minDist}m")
        } catch (e: SecurityException) {
            logErr("requestLocationUpdates SecurityException", e)
            stopSelf()
        }
    }

    /**
     * v0.40.1 — fast switch профиля по speed из location callback.
     *
     * Activity Recognition (Google Play Services) переключает STILL ↔ MOVING с
     * лагом 30-90 сек: ребёнок уже километр проехал в машине, а мы всё ещё в
     * STILL-профиле (interval 60с / minDist 30м), точки приходят редко и трек
     * на карте — пунктирная прямая через посёлки. Чтобы решить — смотрим
     * `loc.speed` (FLP его заполняет когда есть GPS-fix).
     *
     * Логика:
     *   - speed ≥ SPEED_MOVING_MS (≈7 км/ч)  → запоминаем lastMovingTimeMs.
     *     Если профиль STILL → немедленно переключаемся в ACTIVE
     *     (HIGH_ACCURACY, 5с / 10м).
     *   - speed ≤ SPEED_STILL_MS (≈1.8 км/ч) И мы в ACTIVE дольше
     *     STILL_DEBOUNCE_MS без movement-сигнала → переключаемся в STILL.
     *     Debounce защищает от переключений на каждом светофоре.
     *
     * Без speed (loc.hasSpeed()=false, бывает у network-provider) — ничего
     * не делаем, AR transitions работают как раньше (fallback).
     */
    private fun maybeAutoSwitchProfile(loc: android.location.Location) {
        if (!loc.hasSpeed()) return
        val speed = loc.speed
        val now = System.currentTimeMillis()

        if (speed >= SPEED_MOVING_MS) {
            lastMovingTimeMs = now
            if (profile == Profile.STILL) {
                log("auto-switch STILL→ACTIVE: speed=${"%.1f".format(speed)} m/s ≥ $SPEED_MOVING_MS")
                switchProfile(Profile.ACTIVE)
            }
            return
        }

        // Низкий speed — не делаем ничего пока не накопится debounce.
        if (speed <= SPEED_STILL_MS && profile == Profile.ACTIVE) {
            val sinceLastMoving = now - lastMovingTimeMs
            if (lastMovingTimeMs > 0 && sinceLastMoving > STILL_DEBOUNCE_MS) {
                log("auto-switch ACTIVE→STILL: speed=${"%.1f".format(speed)} m/s, ${sinceLastMoving / 1000}s since last movement")
                switchProfile(Profile.STILL)
            }
        }
    }

    private fun switchProfile(newProfile: Profile) {
        if (profile == newProfile) {
            log("switchProfile: already $newProfile, skip")
            return
        }
        log("switchProfile: $profile → $newProfile")
        profile = newProfile
        persistProfile(newProfile)
        // Снимаем текущий callback и подписываемся заново с новыми параметрами.
        // FLP не даёт менять interval/minDistance на лету — только re-request.
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        subscribeLocationUpdates(newProfile)
        // v0.40.3 — motion sensor только в STILL для wake-on-motion. В ACTIVE
        // он не нужен (FLP и так шлёт обновления каждые 5 сек). Это ещё немного
        // экономит батарею + предотвращает «двойные» switch'и (sensor + speed).
        when (newProfile) {
            Profile.STILL -> {
                val ok = motionMonitor.start()
                log("motion sensor: register=$ok kind=${motionMonitor.sensorLabel}")
            }
            Profile.ACTIVE -> {
                motionMonitor.stop()
                log("motion sensor: unregistered (entering ACTIVE)")
            }
        }
    }

    /**
     * v0.40.3 — обработчик motion-sensor trigger'а. Sensor'ы (SIGNIFICANT_MOTION /
     * MOTION_DETECT) вызывают callback с main looper'а — мы тоже на main, поэтому
     * напрямую дёргаем switchProfile без posting'а.
     *
     * Делаем 3 вещи:
     *   1. Обновляем lastMovingTimeMs — чтобы 15-мин ACTIVE→STILL debounce
     *      перезапустился (даже если speed первой точки ещё 0).
     *   2. Switch ACTIVE — поднимаем интервал до 5с / HIGH_ACCURACY.
     *   3. requestFreshLocationOnce — не ждём первую FLP-точку (до 5с), а
     *      запрашиваем актуальную сейчас. UX: первая точка трека приходит
     *      через ~2-3 сек после старта движения, не через 60с STILL_INTERVAL.
     *
     * Idempotent: повторный trigger в ACTIVE-профиле просто обновит
     * lastMovingTimeMs без лишних re-subscribe (см. switchProfile.if-skip).
     */
    private fun onMotionSensorTriggered() {
        lastMovingTimeMs = System.currentTimeMillis()
        if (profile == Profile.STILL) {
            switchProfile(Profile.ACTIVE)
            requestFreshLocationOnce()
        }
    }

    /**
     * Запросить fresh GPS-fix немедленно через `getCurrentLocation` (Google
     * Play Services). В отличие от `lastLocation` (cached), этот запрос
     * включает GPS на полную и возвращает свежую точку через 1-3 сек.
     *
     * Используется только при wake-on-motion — чтобы не ждать FLP-cycle.
     * Точка проходит через тот же `sendToDart` (со всеми фильтрами и speed-based
     * switch), поэтому если sensor сработал, а speed=0 (false positive,
     * телефон поднял со стола) — обычная логика разрулит.
     */
    private fun requestFreshLocationOnce() {
        try {
            fused.getCurrentLocation(
                Priority.PRIORITY_HIGH_ACCURACY,
                null, // CancellationToken — null = не отменяем
            )
                .addOnSuccessListener { loc ->
                    if (loc == null) {
                        log("requestFreshLocationOnce: location is null (no GPS yet)")
                        return@addOnSuccessListener
                    }
                    // v0.41.1 — re-validation. Если GPS не успел поймать спутники,
                    // FLP отдаст cached/Wi-Fi точку. Лучше дропнуть и подождать
                    // FLP-callback (~5 сек с PRIORITY_HIGH_ACCURACY), чем нарисовать
                    // "прыжок" в 30-100 м от реального места.
                    if (!loc.hasSpeed() ||
                        (loc.hasAccuracy() && loc.accuracy > FRESH_LOCATION_MAX_ACCURACY_M)
                    ) {
                        log("requestFreshLocationOnce: REJECT cold-fix (acc=${loc.accuracy} hasSpeed=${loc.hasSpeed()} provider=${loc.provider}), waiting for FLP callback")
                        return@addOnSuccessListener
                    }
                    log("requestFreshLocationOnce: got location, sending")
                    sendToDart(loc, heartbeat = false)
                }
                .addOnFailureListener { e -> logErr("requestFreshLocationOnce failed", e) }
        } catch (e: SecurityException) {
            logErr("requestFreshLocationOnce SecurityException", e)
        } catch (e: Throwable) {
            logErr("requestFreshLocationOnce unexpected", e)
        }
    }

    // Activity Recognition (Play Services). Требует runtime-permission
    // ACTIVITY_RECOGNITION (Android 10+). Без permission requestActivityTransitionUpdates
    // бросит SecurityException — тихо игнорируем и работаем в active-only режиме.
    //
    // v0.31.2: если регистрация завалилась (Play Services отсутствуют, SecurityException
    // не по permission'у, и т.п.), но мы уже в STILL-default — принудительно откатываемся
    // на ACTIVE, чтобы не застрять в "тихом" режиме без MOVING_ENTER-событий.
    private fun registerActivityTransitions() {
        if (!hasActivityRecognitionPermission()) {
            log("activity transitions: ACTIVITY_RECOGNITION not granted, skipping (active-only)")
            ensureActiveFallback("no_permission")
            return
        }
        try {
            val transitions = listOf(
                DetectedActivity.STILL to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.STILL to ActivityTransition.ACTIVITY_TRANSITION_EXIT,
                DetectedActivity.IN_VEHICLE to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.ON_FOOT to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.ON_BICYCLE to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
            ).map { (type, transition) ->
                ActivityTransition.Builder()
                    .setActivityType(type)
                    .setActivityTransition(transition)
                    .build()
            }
            val request = ActivityTransitionRequest(transitions)
            val client = ActivityRecognition.getClient(this)
            client.requestActivityTransitionUpdates(request, activityPendingIntent())
                .addOnSuccessListener { log("activity transitions: registered OK") }
                .addOnFailureListener { e ->
                    logErr("activity transitions: register failed", e)
                    ensureActiveFallback("register_failed")
                }
        } catch (e: SecurityException) {
            logErr("activity transitions: SecurityException (no permission)", e)
            ensureActiveFallback("security_exception")
        } catch (e: Throwable) {
            logErr("activity transitions: unexpected failure", e)
            ensureActiveFallback("unexpected")
        }
    }

    // Safety net для v0.31.2 STILL-default: если по какой-то причине AR
    // не заработал (permission нет / Play Services fail / etc.), а мы
    // сейчас в STILL — ребёнок застрянет в 5-мин интервале без выхода,
    // потому что MOVING_ENTER-сигнал никогда не придёт. Переводим в ACTIVE.
    private fun ensureActiveFallback(reason: String) {
        if (profile == Profile.STILL) {
            log("ensureActiveFallback ($reason): STILL → ACTIVE")
            switchProfile(Profile.ACTIVE)
        }
    }

    private fun unregisterActivityTransitions() {
        try {
            ActivityRecognition.getClient(this)
                .removeActivityTransitionUpdates(activityPendingIntent())
                .addOnSuccessListener { log("activity transitions: unregistered") }
                .addOnFailureListener { e -> logErr("activity transitions: unregister failed", e) }
        } catch (_: Throwable) {
            // ignore
        }
    }

    private fun activityPendingIntent(): PendingIntent {
        return PendingIntent.getBroadcast(
            this,
            ACTIVITY_REQUEST_CODE,
            Intent(this, ActivityTransitionReceiver::class.java)
                .setAction(ActivityTransitionReceiver.ACTION_ACTIVITY_TRANSITION),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun sendToDart(loc: android.location.Location, heartbeat: Boolean) {
        val channel = bgChannel
        if (channel == null) {
            log("sendToDart: bgChannel is null — engine not ready, point DROPPED")
            return
        }

        // v0.40.1: speed-based fast switch профиля. Сделать ДО фильтров —
        // даже если точка будет отфильтрована (acc > gate), факт "speed = 15 м/с"
        // = "ребёнок в машине" → нам важно переключиться в HIGH_ACCURACY быстрее
        // чем мы пропустим reading. switchProfile сам no-op если профиль не меняется.
        maybeAutoSwitchProfile(loc)

        // v0.41.1 — точки без speed (FLP отдал координаты через Wi-Fi MLS / cell
        // positioning, не GPS) идут с ужесточённым gate. Heartbeat исключаем —
        // у него speed=NULL легитимный (lastLocation, может быть старый GPS-fix).
        if (!heartbeat && !loc.hasSpeed() && loc.hasAccuracy() &&
            loc.accuracy > ACCURACY_GATE_NO_SPEED_M
        ) {
            log("sendToDart: DROPPED (no-speed acc=${loc.accuracy} > $ACCURACY_GATE_NO_SPEED_M, provider=${loc.provider})")
            return
        }

        // v0.31.0 accuracy gate: отфильтровываем точки с плохой точностью.
        // Heartbeat'у разрешаем порог помягче — лучше показать родителю
        // "был тут 2 мин назад ±100м", чем молчать.
        val gate = if (heartbeat) ACCURACY_GATE_HEARTBEAT_M else ACCURACY_GATE_M
        if (loc.hasAccuracy() && loc.accuracy > gate) {
            log("sendToDart: DROPPED (accuracy=${loc.accuracy} > $gate, heartbeat=$heartbeat, provider=${loc.provider})")
            return
        }

        // Stationary dedup: если новая точка близко к предыдущей отправленной
        // и прошло меньше DEDUP_WINDOW — считаем это GPS-дрожанием при
        // стоянке на месте. Heartbeat'у dedup НЕ применяем: его задача —
        // гарантированная доставка "жив" каждые 2 минуты.
        if (!heartbeat) {
            val lastLat = lastSentLat
            val lastLon = lastSentLon
            val now = System.currentTimeMillis()
            if (lastLat != null && lastLon != null && now - lastSentTimeMs < DEDUP_WINDOW_MS) {
                val dist = haversineMeters(lastLat, lastLon, loc.latitude, loc.longitude)
                val threshold = maxOf(DEDUP_MIN_DIST_M, (loc.accuracy.takeIf { loc.hasAccuracy() } ?: 0f) * 2f)
                if (dist < threshold) {
                    log("sendToDart: DROPPED (stationary dedup, dist=${"%.1f".format(dist)}m < ${"%.1f".format(threshold)}m)")
                    return
                }
            }
        }

        lastSentLat = loc.latitude
        lastSentLon = loc.longitude
        lastSentTimeMs = System.currentTimeMillis()
        log("sendToDart lat=${loc.latitude} lon=${loc.longitude} acc=${loc.accuracy} hasSpeed=${loc.hasSpeed()} provider=${loc.provider} hb=$heartbeat")
        val (batteryLevel, isCharging) = batterySnapshot()
        val payload = mapOf(
            "lat" to loc.latitude,
            "lon" to loc.longitude,
            "accuracy" to loc.accuracy.toDouble(),
            "altitude" to if (loc.hasAltitude()) loc.altitude else null,
            "speed" to if (loc.hasSpeed()) loc.speed.toDouble() else null,
            "bearing" to if (loc.hasBearing()) loc.bearing.toDouble() else null,
            "batteryLevel" to batteryLevel,
            "isCharging" to isCharging,
            "provider" to (loc.provider ?: "fused"),
            "networkType" to currentNetworkType(),
            "wifiSsid" to currentWifiSsid(),
            "mobileOperator" to currentMobileOperator(),
            "recordedAt" to loc.time,
        )
        channel.invokeMethod("onLocation", payload)
    }

    // Снимок батареи через sticky broadcast ACTION_BATTERY_CHANGED. Более
    // надёжный способ на MIUI/Xiaomi — BatteryManager.isCharging иногда
    // врёт (возвращает false при slow charge / энергосбережении). Intent
    // даёт EXTRA_PLUGGED != 0 как раз когда физически воткнут кабель.
    private fun batterySnapshot(): Pair<Int?, Boolean?> {
        return try {
            val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                ?: return Pair(null, null)
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            val pct = if (level >= 0 && scale > 0) (level * 100 / scale) else null
            val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
            val status = intent.getIntExtra(
                BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN,
            )
            val isCharging = plugged != 0 ||
                status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            Pair(pct, isCharging)
        } catch (_: Throwable) {
            Pair(null, null)
        }
    }

    // Имя текущей Wi-Fi сети. Android возвращает SSID в кавычках ("MyWifi")
    // — убираем. На Android <28 без FINE_LOCATION возвращается
    // "<unknown ssid>" — отфильтровываем. На Android 12+ требуется
    // NEARBY_WIFI_DEVICES (уже в манифесте).
    private fun currentWifiSsid(): String? {
        return try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                ?: return null
            @Suppress("DEPRECATION")
            val info = wm.connectionInfo ?: return null
            @Suppress("DEPRECATION")
            val raw = info.ssid ?: return null
            val unquoted = raw.removePrefix("\"").removeSuffix("\"")
            if (unquoted.isEmpty() || unquoted == "<unknown ssid>" || unquoted == "0x") null
            else unquoted.take(64)
        } catch (_: Throwable) {
            null
        }
    }

    // Имя оператора текущей мобильной сети (МТС, Билайн, МегаФон и т.п.).
    // Не требует READ_PHONE_STATE для чтения name. Если SIM нет или
    // телефон в режиме "только Wi-Fi" — возвращаем null.
    private fun currentMobileOperator(): String? {
        return try {
            val tm = applicationContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                ?: return null
            val name = tm.networkOperatorName
            if (name.isNullOrBlank()) null else name.take(64)
        } catch (_: Throwable) {
            null
        }
    }

    private fun currentNetworkType(): String {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "unknown"
        val active = cm.activeNetwork ?: return "offline"
        val caps = cm.getNetworkCapabilities(active) ?: return "offline"
        if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return "offline"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "wifi"
            else -> "unknown"
        }
    }

    private fun buildNotification(): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Перископ — подключено к семье")
            .setContentText("Маме/папе видно твоё местоположение")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Перископ — геолокация", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    // Защита от свайпа: когда пользователь смахивает приложение из recents,
    // Android вызывает onTaskRemoved() и затем убивает процесс. START_STICKY
    // на MIUI/Huawei/Oppo не гарантирует рестарт. Ставим AlarmManager с exact
    // alarm на +3 сек — RestartReceiver поднимет сервис обратно.
    // setExactAndAllowWhileIdle даёт short-term exemption от FGS-restrictions
    // на Android 12+, поэтому startForegroundService в ресивере разрешён.
    override fun onTaskRemoved(rootIntent: Intent?) {
        log("onTaskRemoved: scheduling AlarmManager restart in 3s")
        try {
            val pi = PendingIntent.getBroadcast(
                this,
                0,
                Intent(this, RestartReceiver::class.java).setAction(RestartReceiver.ACTION_RESTART),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val triggerAt = System.currentTimeMillis() + 3_000L
            val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                am.canScheduleExactAlarms()
            } else true
            if (canExact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                log("onTaskRemoved: exact alarm scheduled")
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                log("onTaskRemoved: inexact alarm scheduled (no SCHEDULE_EXACT_ALARM)")
            }
        } catch (e: Throwable) {
            logErr("onTaskRemoved: alarm schedule failed", e)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        log("onDestroy")
        // Alarm НЕ отменяем в onDestroy — если система прибила service, но
        // потом перезапустит его по START_STICKY/RestartReceiver, alarm-цепочка
        // сохранит heartbeat. Отменяем только при явном ACTION_STOP.
        // Activity transitions тоже оставляем подписанными — ресивер умеет
        // стартануть service при надобности, пере-подписка при ACTION_STOP.
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        // Motion sensor отписываем — иначе если service rebornит, при start()
        // будет регистрация поверх старой (хотя isRegistered защищает).
        motionMonitor.stop()
        releaseWakeLock()
        // Не рушим bgEngine при onDestroy — он может пригодиться, если service
        // тут же перезапустят (START_STICKY). Чистим только при явном ACTION_STOP.
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // Haversine (метры). Используется в stationary-dedup для сравнения
    // расстояния между соседними точками. Точность ±0.5% на дистанциях
    // до 100м — нам сверх достаточно.
    private fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2).let { it * it } +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLon / 2).let { it * it }
        return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}
