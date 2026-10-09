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
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
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
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity
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
 *
 * v0.73.1 (защита от кражи): NetworkCallback следит за интернетом. Нет
 * проверенного интернета (сим вынута, мобильные данные выключены, режим полёта)
 * — запрос переключается на PRIORITY_HIGH_ACCURACY: без сети «баланс» опирается
 * на Wi-Fi и вышки и почти не даёт точек, а GPS работает и офлайн. Точки копятся
 * в [ParentLocationBuffer]. Интернет вернулся — обратно BALANCED и
 * [ParentLocationUploader.onNetworkAvailable] сразу отдаёт накопленное.
 *
 * v0.77.0 (треки «Найти телефон» без прямых и дыр): профили «в движении /
 * на месте», как у LocationForegroundService ребёнка. ACTIVE —
 * PRIORITY_HIGH_ACCURACY, интервал 5 с, фильтр смещения 10 м. STILL — то,
 * что описано выше (BALANCED 60 с / мин. 30 с, фильтр 50 м; офлайн —
 * HIGH_ACCURACY). Keepalive 5 минут и отброс по accuracy — в обоих профилях.
 * Решение о переключении — [ParentMotionPolicy] (скорость ≥ 2 м/с → ACTIVE
 * сразу; обратно в STILL — после 15 минут без движения; AR «STILL» — только
 * если движения не было 3 минуты; страховка «уехал от места стоянки»).
 * Источники сигналов: скорость точек, Activity Recognition
 * ([ParentActivityTransitionReceiver], разрешение «Физическая активность»),
 * датчик значимого движения в STILL ([MotionSensorMonitor]). Стартовый
 * профиль — STILL при выданном разрешении AR, иначе ACTIVE с уходом в STILL
 * по таймеру без движения. Каждое переключение и причина — в DiagLog (ploc).
 */
class ParentLocationService : Service() {

    companion object {
        const val CHANNEL_ID = "periscop_parent_location"
        const val NOTIF_ID = 0xB1
        const val ACTION_START = "pro.periscop.parent.location.START"
        const val ACTION_STOP = "pro.periscop.parent.location.STOP"
        /** v0.77.0: события Activity Recognition от [ParentActivityTransitionReceiver]. */
        const val ACTION_ACTIVITY_STILL = "pro.periscop.parent.location.ACTIVITY_STILL"
        const val ACTION_ACTIVITY_MOVING = "pro.periscop.parent.location.ACTIVITY_MOVING"

        /** STILL: на месте — экономно (как до v0.77.0). */
        private const val STILL_INTERVAL_MS = 60_000L
        private const val STILL_MIN_INTERVAL_MS = 30_000L
        private const val STILL_MIN_DISTANCE_M = 50f
        /** ACTIVE: в движении — GPS, плотный трек (как у ребёнка). */
        private const val ACTIVE_INTERVAL_MS = 5_000L
        private const val ACTIVE_MIN_INTERVAL_MS = 2_500L
        private const val ACTIVE_MIN_DISTANCE_M = 10f
        /**
         * Первая точка после пробуждения датчиком / escape: хуже — ждём обычную
         * точку ACTIVE (до 5 с), а не рисуем скачок от Wi-Fi.
         */
        private const val FRESH_LOCATION_MAX_ACCURACY_M = 30f
        private const val ACTIVITY_REQUEST_CODE = 0xB2
        /** Без движения — подтверждающая точка не реже, чем раз в 5 минут. */
        private const val KEEPALIVE_MS = 5 * 60_000L
        private const val MAX_ACCURACY_M = 100f
        /** Выдана только «приблизительная» геолокация: точнее она не бывает. */
        private const val MAX_ACCURACY_COARSE_M = 500f
        private const val RESTART_DELAY_MS = 3_000L
        /** Сети прыгают (Wi-Fi → мобильная): состояние перепроверяем с задержкой. */
        private const val NET_SETTLE_MS = 3_000L

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

        /** «Физическая активность» (Activity Recognition). До Android 10 не нужна. */
        fun hasActivityRecognitionPermission(ctx: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
            return ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACTIVITY_RECOGNITION,
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
    /** Есть проверенный интернет; null — ещё не знаем (до первой проверки). */
    private var online: Boolean? = null
    private var currentPriority = Priority.PRIORITY_BALANCED_POWER_ACCURACY
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private val netCheck = Runnable { reevaluateNetwork() }

    // v0.77.0 — профиль «в движении / на месте» (см. ParentMotionPolicy).
    private var profile = ParentMotionPolicy.Profile.STILL
    /** elapsedRealtime последнего движения; 0 — не было. */
    private var lastMovingAtMs = 0L
    /** Место, где перешли в STILL, и счётчик точек подряд далеко от него. */
    private var stillAnchor: Location? = null
    private var stillEscapeHits = 0
    /** Подписка Activity Recognition поставлена (повторный start() не дублирует). */
    private var arRegistered = false
    private val applyArStill = Runnable { onArStill() }
    private val motionMonitor: MotionSensorMonitor by lazy {
        MotionSensorMonitor(applicationContext) { onMotionSensorTriggered() }
    }

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
        when (intent?.action) {
            ACTION_STOP -> {
                stopEverything("ACTION_STOP")
                return START_NOT_STICKY
            }
            ACTION_ACTIVITY_STILL, ACTION_ACTIVITY_MOVING -> {
                // Ресивер шлёт события только живой службе (running), но к
                // приходу intent'а её могли остановить: без подписки событие
                // не нужно, а сервис, созданный этим startService, гасим.
                if (callback == null) {
                    log("AR ${intent.action}: подписки нет — пропуск")
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                if (intent.action == ACTION_ACTIVITY_STILL) {
                    onArStill()
                } else {
                    applyDecision(
                        ParentMotionPolicy.onMoving(profile, SystemClock.elapsedRealtime(), "AR: движение"),
                    )
                }
                return START_STICKY
            }
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
            // Повторный старт из UI — в т.ч. после выдачи «Физической
            // активности»: подписаться на AR, если ещё не подписаны.
            log("start: уже подписаны — пропуск")
            registerActivityTransitions()
            return
        }
        online = isOnline()
        // Как у ребёнка: с разрешением AR — сразу экономный STILL (AR и датчик
        // разбудят), без него — ACTIVE, а в STILL уйдём по 15 мин без движения.
        val arGranted = hasActivityRecognitionPermission(this)
        profile = if (arGranted) ParentMotionPolicy.Profile.STILL else ParentMotionPolicy.Profile.ACTIVE
        lastMovingAtMs = if (profile == ParentMotionPolicy.Profile.ACTIVE) SystemClock.elapsedRealtime() else 0L
        stillAnchor = null
        stillEscapeHits = 0
        log(
            "start: профиль $profile (AR=$arGranted), датчик движения ${motionMonitor.sensorLabel}",
        )
        currentPriority = priorityFor(profile, online == true)
        subscribe()
        if (callback == null) return // SecurityException — служба уже остановлена
        if (profile == ParentMotionPolicy.Profile.STILL) {
            log("motion sensor: register=${motionMonitor.start()} (старт в STILL)")
        }
        registerNetworkCallback()
        registerActivityTransitions()
        ioHandler?.post { uploader?.flushPending() }
    }

    /**
     * ACTIVE — всегда GPS. STILL — «баланс» при интернете и GPS офлайн
     * (v0.73.1: без сети «баланс» почти не даёт точек).
     */
    private fun priorityFor(p: ParentMotionPolicy.Profile, isOnline: Boolean) =
        if (p == ParentMotionPolicy.Profile.STILL && isOnline) {
            Priority.PRIORITY_BALANCED_POWER_ACCURACY
        } else {
            Priority.PRIORITY_HIGH_ACCURACY
        }

    /** Есть интернет, проверенный системой (а не просто «подключено к Wi-Fi»). */
    private fun isOnline(): Boolean = try {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        caps != null &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } catch (_: Throwable) {
        true // не знаем — ведём себя как раньше
    }

    private fun registerNetworkCallback() {
        if (netCallback != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = scheduleNetCheck()
            override fun onLost(network: Network) = scheduleNetCheck()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
                scheduleNetCheck()
        }
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (e: Throwable) {
            log("network callback FAILED: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun unregisterNetworkCallback() {
        mainHandler.removeCallbacks(netCheck)
        val cb = netCallback ?: return
        netCallback = null
        try {
            (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                .unregisterNetworkCallback(cb)
        } catch (_: Throwable) {
        }
    }

    private fun scheduleNetCheck() {
        mainHandler.removeCallbacks(netCheck)
        mainHandler.postDelayed(netCheck, NET_SETTLE_MS)
    }

    /** Main thread: сменить режим геолокации и при появлении сети — отдать буфер. */
    private fun reevaluateNetwork() {
        if (callback == null) return
        val now = isOnline()
        val was = online
        if (now == was) return
        online = now
        log("network: ${if (now) "интернет есть" else "интернета нет"} (было ${was ?: "?"})")
        val wanted = priorityFor(profile, now)
        if (wanted != currentPriority) {
            currentPriority = wanted
            resubscribe()
        }
        if (now) ioHandler?.post { uploader?.onNetworkAvailable() }
    }

    /** Та же подписка с другим приоритетом / профилем (lastSent сохраняем). */
    private fun resubscribe() {
        callback?.let {
            try {
                fused.removeLocationUpdates(it)
            } catch (_: Throwable) {
            }
        }
        callback = null
        subscribe()
    }

    private fun subscribe() {
        val active = profile == ParentMotionPolicy.Profile.ACTIVE
        val interval = if (active) ACTIVE_INTERVAL_MS else STILL_INTERVAL_MS
        val request = LocationRequest.Builder(currentPriority, interval)
            .setMinUpdateIntervalMillis(if (active) ACTIVE_MIN_INTERVAL_MS else STILL_MIN_INTERVAL_MS)
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
            val mode = when {
                currentPriority != Priority.PRIORITY_HIGH_ACCURACY -> "balanced"
                active -> "GPS"
                else -> "GPS (офлайн)"
            }
            log(
                "requestLocationUpdates OK $profile $mode interval=${interval}ms " +
                    "minDist=${minDistance()}m",
            )
        } catch (e: SecurityException) {
            log("requestLocationUpdates SecurityException: ${e.message}")
            callback = null
            stopEverything("SecurityException")
        }
    }

    private fun onLocation(loc: Location) {
        // v0.77.0: профиль — ДО фильтра точности, как у ребёнка: и грубая
        // точка со скоростью 15 м/с значит «едем», а далёкая грубая точка в
        // STILL — кандидат «уехал от места стоянки».
        val now = SystemClock.elapsedRealtime()
        applyDecision(
            ParentMotionPolicy.onLocation(
                profile, loc.hasSpeed(), loc.speed, now, lastMovingAtMs, stillEscapeHits,
            ),
        )
        maybeEscapeStill(loc, now)

        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val maxAccuracy = if (fine) MAX_ACCURACY_M else MAX_ACCURACY_COARSE_M
        if (!loc.hasAccuracy() || loc.accuracy > maxAccuracy) {
            log("point skipped: accuracy=${if (loc.hasAccuracy()) loc.accuracy else -1f}")
            return
        }
        val prev = lastSent
        if (prev != null && loc.distanceTo(prev) < minDistance() &&
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

    /** Свой фильтр смещения: в движении плотнее. */
    private fun minDistance(): Float =
        if (profile == ParentMotionPolicy.Profile.ACTIVE) ACTIVE_MIN_DISTANCE_M else STILL_MIN_DISTANCE_M

    // ---- v0.77.0: профили «в движении / на месте» ----------------------------

    /** Применить решение политики: время движения, счётчик escape, смена профиля. */
    private fun applyDecision(d: ParentMotionPolicy.Decision) {
        lastMovingAtMs = d.lastMovingAtMs
        stillEscapeHits = d.escapeHits
        if (d.recheckInMs > 0) {
            log("AR STILL отложен: движение было недавно, перепроверка через ${d.recheckInMs / 1000} с")
            mainHandler.removeCallbacks(applyArStill)
            mainHandler.postDelayed(applyArStill, d.recheckInMs)
        }
        if (d.profile != profile) switchProfile(d.profile, d.reason ?: "?")
    }

    /** AR «STILL ENTER» — или перепроверка отложенного (см. applyArStill). */
    private fun onArStill() {
        mainHandler.removeCallbacks(applyArStill)
        if (callback == null) return
        applyDecision(ParentMotionPolicy.onArStill(profile, SystemClock.elapsedRealtime(), lastMovingAtMs))
    }

    /** Страховка в STILL: AR в транспорте может молчать, а точки Wi-Fi/вышек — нет. */
    private fun maybeEscapeStill(loc: Location, now: Long) {
        if (profile != ParentMotionPolicy.Profile.STILL) return
        val anchor = stillAnchor
        if (anchor == null) {
            stillAnchor = Location(loc)
            return
        }
        val d = ParentMotionPolicy.onStillPoint(
            profile,
            loc.distanceTo(anchor).toDouble(),
            if (loc.hasAccuracy()) loc.accuracy else null,
            stillEscapeHits,
            now,
            lastMovingAtMs,
        )
        if (d.escapeHits > 0) {
            log("STILL escape кандидат #${d.escapeHits}: ${loc.distanceTo(anchor).toInt()} м от стоянки")
        }
        val wasStill = profile == ParentMotionPolicy.Profile.STILL
        applyDecision(d)
        if (wasStill && profile == ParentMotionPolicy.Profile.ACTIVE) requestFreshLocationOnce()
    }

    private fun onMotionSensorTriggered() {
        if (callback == null) return
        val wasStill = profile == ParentMotionPolicy.Profile.STILL
        applyDecision(
            ParentMotionPolicy.onMoving(
                profile, SystemClock.elapsedRealtime(), "датчик движения (${motionMonitor.sensorLabel})",
            ),
        )
        if (wasStill && profile == ParentMotionPolicy.Profile.ACTIVE) requestFreshLocationOnce()
    }

    private fun switchProfile(newProfile: ParentMotionPolicy.Profile, reason: String) {
        if (profile == newProfile) return
        log("профиль $profile → $newProfile: $reason")
        profile = newProfile
        stillEscapeHits = 0
        if (newProfile == ParentMotionPolicy.Profile.STILL) {
            // Якорь — последняя отправленная точка (обычно точная, из ACTIVE);
            // нет её — якорем станет первая точка в STILL.
            stillAnchor = lastSent?.let { Location(it) }
            log("motion sensor: register=${motionMonitor.start()}")
        } else {
            stillAnchor = null
            // Вход в ACTIVE — отсчёт 15 минут до STILL с этого момента.
            lastMovingAtMs = maxOf(lastMovingAtMs, SystemClock.elapsedRealtime())
            mainHandler.removeCallbacks(applyArStill)
            motionMonitor.stop()
        }
        if (callback != null) {
            currentPriority = priorityFor(newProfile, online != false)
            resubscribe()
        }
    }

    /**
     * Свежая точка сразу после пробуждения (датчик / escape), не дожидаясь
     * первой точки ACTIVE. Холодная (без скорости или хуже 30 м) — отбрасываем.
     */
    private fun requestFreshLocationOnce() {
        try {
            fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { loc ->
                    if (loc == null || callback == null) return@addOnSuccessListener
                    if (!loc.hasSpeed() || (loc.hasAccuracy() && loc.accuracy > FRESH_LOCATION_MAX_ACCURACY_M)) {
                        log("fresh location: холодная (acc=${loc.accuracy} speed=${loc.hasSpeed()}) — ждём FLP")
                        return@addOnSuccessListener
                    }
                    onLocation(loc)
                }
                .addOnFailureListener { e -> log("fresh location FAILED: ${e.javaClass.simpleName}: ${e.message}") }
        } catch (e: Throwable) {
            log("fresh location FAILED: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /**
     * Activity Recognition (Play Services). Без разрешения «Физическая
     * активность» — работаем по скорости, датчику и escape; застрявший STILL
     * переводим в ACTIVE (уйдёт обратно по 15 мин без движения).
     */
    private fun registerActivityTransitions() {
        if (arRegistered) return
        if (!hasActivityRecognitionPermission(this)) {
            log("AR: нет разрешения «Физическая активность» — без AR")
            ensureActiveFallback("нет разрешения AR")
            return
        }
        arRegistered = true
        try {
            val transitions = listOf(
                DetectedActivity.STILL to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.STILL to ActivityTransition.ACTIVITY_TRANSITION_EXIT,
                DetectedActivity.IN_VEHICLE to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.ON_FOOT to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.WALKING to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.RUNNING to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.ON_BICYCLE to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
            ).map { (type, transition) ->
                ActivityTransition.Builder()
                    .setActivityType(type)
                    .setActivityTransition(transition)
                    .build()
            }
            ActivityRecognition.getClient(this)
                .requestActivityTransitionUpdates(ActivityTransitionRequest(transitions), activityPendingIntent())
                .addOnSuccessListener { log("AR: подписка OK") }
                .addOnFailureListener { e ->
                    arRegistered = false
                    log("AR: подписка FAILED: ${e.javaClass.simpleName}: ${e.message}")
                    ensureActiveFallback("подписка AR не удалась")
                }
        } catch (e: Throwable) {
            arRegistered = false
            log("AR: подписка FAILED: ${e.javaClass.simpleName}: ${e.message}")
            ensureActiveFallback("подписка AR не удалась")
        }
    }

    private fun ensureActiveFallback(reason: String) {
        if (callback != null && profile == ParentMotionPolicy.Profile.STILL) {
            switchProfile(ParentMotionPolicy.Profile.ACTIVE, reason)
        }
    }

    private fun unregisterActivityTransitions() {
        if (!arRegistered) return
        arRegistered = false
        try {
            ActivityRecognition.getClient(this)
                .removeActivityTransitionUpdates(activityPendingIntent())
                .addOnFailureListener { e -> log("AR: отписка FAILED: ${e.javaClass.simpleName}: ${e.message}") }
        } catch (_: Throwable) {
        }
    }

    // FLAG_MUTABLE обязателен: Play Services дописывает результат в intent.
    private fun activityPendingIntent(): PendingIntent = PendingIntent.getBroadcast(
        this,
        ACTIVITY_REQUEST_CODE,
        Intent(this, ParentActivityTransitionReceiver::class.java)
            .setAction(ParentActivityTransitionReceiver.ACTION_ACTIVITY_TRANSITION),
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

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
        unregisterNetworkCallback()
        unregisterActivityTransitions()
        mainHandler.removeCallbacks(applyArStill)
        motionMonitor.stop()
        stillAnchor = null
        stillEscapeHits = 0
        online = null
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
