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
import android.os.Handler
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
        // Отдельный engine для headless-изолята фонового сервиса. UI-Activity
        // держит свой engine через FlutterActivity — они не пересекаются.
        const val BG_ENGINE_ID = "gmd_bg_location_engine"
        const val DART_ENTRYPOINT = "locationEntryPoint"
        const val DART_LIBRARY_URI = "package:gmd_child/background/location_entry.dart"
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        private const val WAKE_LOCK_TAG = "gmd:LocationForegroundService"
        // Heartbeat — гарантированная точка раз в 2 минуты, даже если телефон
        // неподвижен и fused с distance-filter 5м не присылает обновлений.
        // Родитель в web видит "Был тут только что" независимо от движения.
        private const val HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000L
    }

    private lateinit var fused: FusedLocationProviderClient
    private var callback: LocationCallback? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var bgEngine: FlutterEngine? = null
    private var bgChannel: MethodChannel? = null
    private var heartbeatHandler: Handler? = null
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            log("heartbeat tick")
            try {
                fused.lastLocation
                    .addOnSuccessListener { loc ->
                        if (loc != null) {
                            log("heartbeat: got last location, sending")
                            sendToDart(loc)
                        } else {
                            log("heartbeat: lastLocation is null — provider has no cached fix yet")
                        }
                    }
                    .addOnFailureListener { e -> logErr("heartbeat lastLocation failed", e) }
            } catch (e: SecurityException) {
                logErr("heartbeat lastLocation SecurityException", e)
            }
            heartbeatHandler?.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    private fun log(msg: String) = DiagLog.write(this, "svc", msg)
    private fun logErr(msg: String, e: Throwable) =
        DiagLog.write(this, "svc", "$msg: ${e.javaClass.simpleName}: ${e.message}")

    override fun onCreate() {
        super.onCreate()
        log("onCreate")
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
        ensureBackgroundEngine()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        log("onStartCommand action=${intent?.action} flags=$flags startId=$startId")
        when (intent?.action) {
            ACTION_STOP -> {
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> start()
        }
        return START_STICKY
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
        startForeground(NOTIF_ID, buildNotification())
        acquireWakeLock()
        ensureBackgroundEngine()
        if (callback != null) {
            log("start: callback already subscribed, skip requestLocationUpdates")
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L)
            .setMinUpdateDistanceMeters(5f)
            .setMinUpdateIntervalMillis(5_000L)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                log("onLocationResult size=${result.locations.size}")
                for (loc in result.locations) {
                    sendToDart(loc)
                }
            }
        }
        callback = cb
        try {
            fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
            log("requestLocationUpdates OK")
        } catch (e: SecurityException) {
            logErr("requestLocationUpdates SecurityException", e)
            stopSelf()
            return
        }
        // Heartbeat: шлём текущую точку раз в 2 минуты, даже если телефон
        // неподвижен и fused молчит из-за distance-filter 5м.
        if (heartbeatHandler == null) {
            heartbeatHandler = Handler(Looper.getMainLooper()).also {
                it.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
                log("heartbeat scheduled every ${HEARTBEAT_INTERVAL_MS / 1000}s")
            }
        }
    }

    private fun sendToDart(loc: android.location.Location) {
        val channel = bgChannel
        if (channel == null) {
            log("sendToDart: bgChannel is null — engine not ready, point DROPPED")
            return
        }
        log("sendToDart lat=${loc.latitude} lon=${loc.longitude} acc=${loc.accuracy}")
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
            .setContentTitle("GMD — подключено к семье")
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
                NotificationChannel(CHANNEL_ID, "GMD location", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    override fun onDestroy() {
        log("onDestroy")
        heartbeatHandler?.removeCallbacks(heartbeatRunnable)
        heartbeatHandler = null
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        releaseWakeLock()
        // Не рушим bgEngine при onDestroy — он может пригодиться, если service
        // тут же перезапустят (START_STICKY). Чистим только при явном ACTION_STOP.
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
