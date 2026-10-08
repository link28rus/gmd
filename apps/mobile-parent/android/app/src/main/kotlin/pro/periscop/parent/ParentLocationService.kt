package pro.periscop.parent

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * v0.70.0 — фоновая передача местоположения родителя семье.
 *
 * Минимальная копия LocationForegroundService приложения ребёнка (спека
 * 2026-10-08-family-map-parent-location): FGS type=location, START_STICKY,
 * идемпотентный start() с проверкой разрешения, onTaskRemoved → перезапуск
 * будильником через 3 с. Без headless FlutterEngine, Drift, Activity
 * Recognition и датчика движения: точки уходят нативно
 * ([ParentLocationUploader]).
 *
 * Fused Location: BALANCED_POWER_ACCURACY, интервал 60 с, минимум 30 с;
 * точки с accuracy > 100 м отбрасываются. На сервер уходит точка, если
 * родитель сдвинулся на 50 м ИЛИ с прошлой прошло 5 минут: иначе стоящий
 * на месте родитель через 10 минут посерел бы на карте семьи («нет данных»).
 * Фильтр смещения — наш, а не setMinUpdateDistanceMeters: тот глушит и
 * подтверждающие точки.
 *
 * v0.73.0 («Найти телефон»): служба работает всегда, пока родитель вошёл и
 * выдал геолокацию, — флаг «Показывать меня семье» влияет только на видимость
 * семье (решает сервер). Текст постоянного уведомления нейтральный: верен при
 * любом положении флага. При старте службы обновляется кэш FCM-токена для
 * `device.pushToken` ([FindPhoneSignal.refreshFcmToken]).
 */
class ParentLocationService : Service() {

    companion object {
        const val CHANNEL_ID = "periscop_parent_location"
        const val NOTIF_ID = 0xB1
        const val ACTION_START = "pro.periscop.parent.location.START"
        const val ACTION_STOP = "pro.periscop.parent.location.STOP"

        private const val INTERVAL_MS = 60_000L
        private const val MIN_INTERVAL_MS = 30_000L
        private const val MIN_DISTANCE_M = 50f
        /** Без движения — подтверждающая точка не реже, чем раз в 5 минут. */
        private const val KEEPALIVE_MS = 5 * 60_000L
        private const val MAX_ACCURACY_M = 100f
        /** Выдана только «приблизительная» геолокация: точнее она не бывает. */
        private const val MAX_ACCURACY_COARSE_M = 500f
        private const val RESTART_DELAY_MS = 3_000L

        /** Служба подписана на точки в этом процессе. */
        @Volatile
        var running = false
            private set

        private fun log(ctx: Context, msg: String) = DiagLog.write(ctx, "ploc", msg)

        fun hasLocationPermission(ctx: Context): Boolean =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED

        /**
         * «Разрешать всегда». Нужна для старта из фона (перезагрузка, обновление,
         * сторож, будильник): на Android 14+ FGS type=location, запущенный из
         * фона без неё, падает SecurityException. До Android 10 отдельного
         * разрешения нет — хватает обычного.
         */
        fun hasBackgroundPermission(ctx: Context): Boolean {
            if (!hasLocationPermission(ctx)) return false
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
            return ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
        }

        /** Есть токен, флаг включён, выдано разрешение на геолокацию. */
        fun shouldRun(ctx: Context): Boolean =
            ParentLocationCreds.read(ctx).usable && hasLocationPermission(ctx)

        /**
         * Поднять службу, если она должна работать. [fromBackground] — вызов не
         * из открытого UI (ресивер, сторож, будильник): тогда нужна «Разрешать
         * всегда», а уже живую службу не дёргаем. Проверки — ДО
         * startForegroundService: служба, не вызвавшая startForeground, роняет
         * процесс.
         */
        fun ensureStarted(ctx: Context, reason: String, fromBackground: Boolean): Boolean {
            if (!shouldRun(ctx)) {
                log(ctx, "ensureStarted($reason): не нужно (нет токена / флаг выкл / нет разрешения)")
                return false
            }
            if (fromBackground) {
                if (running) return true
                if (!hasBackgroundPermission(ctx)) {
                    log(ctx, "ensureStarted($reason): пропуск — нет «Разрешать всегда»")
                    return false
                }
            }
            return try {
                ContextCompat.startForegroundService(
                    ctx,
                    Intent(ctx, ParentLocationService::class.java).setAction(ACTION_START),
                )
                log(ctx, "ensureStarted($reason): startForegroundService")
                true
            } catch (e: Throwable) {
                // Android 12+: ForegroundServiceStartNotAllowedException из фона
                // без исключения (нет «без ограничений батареи»).
                log(ctx, "ensureStarted($reason) FAILED: ${e.javaClass.simpleName}: ${e.message}")
                false
            }
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, ParentLocationService::class.java))
            } catch (e: Throwable) {
                log(ctx, "stop FAILED: ${e.javaClass.simpleName}: ${e.message}")
            }
        }

        private fun isoUtc(ms: Long): String =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(Date(ms))
    }

    private lateinit var fused: FusedLocationProviderClient
    private var callback: LocationCallback? = null
    private var ioThread: HandlerThread? = null
    private var ioHandler: Handler? = null
    private var uploader: ParentLocationUploader? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastSent: Location? = null

    private fun log(msg: String) = log(this, msg)

    override fun onCreate() {
        super.onCreate()
        log("onCreate")
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
        FindPhoneSignal.refreshFcmToken(this)
        val t = HandlerThread("ploc-upload").also { it.start() }
        ioThread = t
        val h = Handler(t.looper)
        ioHandler = h
        uploader = ParentLocationUploader(this, h) { reason ->
            mainHandler.post { stopFromUploader(reason) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        log("onStartCommand action=${intent?.action} startId=$startId")
        if (intent?.action == ACTION_STOP) {
            stopEverything("ACTION_STOP")
            return START_NOT_STICKY
        }
        start()
        return START_STICKY
    }

    private fun start() {
        // Без разрешения startForeground(type=location) бросает SecurityException
        // на Android 14+. Вызывающие проверяют то же до startForegroundService.
        if (!hasLocationPermission(this)) {
            log("start: SKIPPED — нет ACCESS_*_LOCATION; stopSelf")
            stopSelf()
            return
        }
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type)
        } catch (e: Throwable) {
            // Старт из фона без «Разрешать всегда» (перезапуск по START_STICKY).
            log("start: startForeground FAILED: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
            return
        }
        if (!ParentLocationCreds.read(this).usable) {
            log("start: нет кредов или флаг выключен — стоп")
            stopEverything("no creds")
            return
        }
        if (callback != null) {
            log("start: уже подписаны — пропуск")
            return
        }
        subscribe()
        ioHandler?.post { uploader?.flushPending() }
    }

    private fun subscribe() {
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_INTERVAL_MS)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (loc in result.locations) onLocation(loc)
            }
        }
        callback = cb
        try {
            fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
            running = true
            log("requestLocationUpdates OK interval=${INTERVAL_MS}ms minDist=${MIN_DISTANCE_M}m")
        } catch (e: SecurityException) {
            log("requestLocationUpdates SecurityException: ${e.message}")
            callback = null
            stopEverything("SecurityException")
        }
    }

    private fun onLocation(loc: Location) {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val maxAccuracy = if (fine) MAX_ACCURACY_M else MAX_ACCURACY_COARSE_M
        if (!loc.hasAccuracy() || loc.accuracy > maxAccuracy) {
            log("point skipped: accuracy=${if (loc.hasAccuracy()) loc.accuracy else -1f}")
            return
        }
        val prev = lastSent
        if (prev != null && loc.distanceTo(prev) < MIN_DISTANCE_M &&
            loc.time - prev.time < KEEPALIVE_MS
        ) {
            return
        }
        lastSent = loc
        val (battery, charging) = batterySnapshot()
        val p = JSONObject()
            .put("lat", loc.latitude)
            .put("lon", loc.longitude)
            .put("recordedAt", isoUtc(loc.time))
            .put("accuracy", loc.accuracy.toDouble())
            .put("isMock", isMock(loc))
        if (loc.hasSpeed()) p.put("speed", loc.speed.toDouble())
        if (loc.hasBearing()) p.put("bearing", loc.bearing.toDouble())
        battery?.let { p.put("batteryLevel", it) }
        charging?.let { p.put("isCharging", it) }
        loc.provider?.let { p.put("provider", it) }
        ioHandler?.post { uploader?.add(p) }
    }

    private fun isMock(loc: Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            loc.isMock
        } else {
            @Suppress("DEPRECATION")
            loc.isFromMockProvider
        }

    // Как у ребёнка: sticky ACTION_BATTERY_CHANGED надёжнее BatteryManager на MIUI.
    private fun batterySnapshot(): Pair<Int?, Boolean?> = try {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (i == null) {
            Pair(null, null)
        } else {
            val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            val pct = if (level >= 0 && scale > 0) level * 100 / scale else null
            val plugged = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
            val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
            Pair(
                pct,
                plugged != 0 || status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL,
            )
        }
    } catch (_: Throwable) {
        Pair(null, null)
    }

    /** Uploader решил остановиться (401). */
    private fun stopFromUploader(reason: String) {
        ParentLocationWatchdogWorker.cancel(this)
        stopEverything("uploader: $reason")
    }

    private fun stopEverything(reason: String) {
        log("stop: $reason")
        unsubscribe()
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (_: Throwable) {
        }
        stopSelf()
    }

    private fun unsubscribe() {
        callback?.let {
            try {
                fused.removeLocationUpdates(it)
            } catch (_: Throwable) {
            }
        }
        callback = null
        lastSent = null
        running = false
    }

    private fun buildNotification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Перископ: геолокация включена")
            .setContentText("Нужна для «Найти телефон». Семья видит вас на карте, если это включено в меню.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("Нужна для «Найти телефон». Семья видит вас на карте, если это включено в меню."),
            )
            .setSmallIcon(R.drawable.ic_stat_location)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pi)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Перископ — моё местоположение",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "Геолокация этого телефона для «Найти телефон» и карты семьи" },
            )
        }
    }

    // Свайп из «Недавних»: на MIUI/Huawei/Oppo процесс убивают вместе со
    // службой, START_STICKY там не срабатывает. Будильник через 3 с поднимет
    // её через ParentLocationRestartReceiver (как у ребёнка). Точный будильник
    // (USE_EXACT_ALARM в манифесте, как у ребёнка) даёт исключение из запрета
    // старта FGS из фона; если права всё же нет — неточный, тогда старт
    // пройдёт только при «без ограничений батареи».
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (running && ParentLocationCreds.read(this).usable) {
            log("onTaskRemoved: перезапуск будильником через 3 с")
            try {
                val pi = PendingIntent.getBroadcast(
                    this,
                    0,
                    Intent(this, ParentLocationRestartReceiver::class.java)
                        .setAction(ParentLocationRestartReceiver.ACTION_RESTART),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val at = System.currentTimeMillis() + RESTART_DELAY_MS
                val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
                if (canExact) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                }
            } catch (e: Throwable) {
                log("onTaskRemoved: alarm FAILED: ${e.javaClass.simpleName}: ${e.message}")
            }
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        log("onDestroy")
        unsubscribe()
        uploader?.shutdown()
        uploader = null
        ioThread?.quitSafely()
        ioThread = null
        ioHandler = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
