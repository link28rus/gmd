package pro.periscop.child

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
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
        const val CHANNEL_ID = "periscop_location_channel"
        const val NOTIF_ID = 0xC1
        const val METHOD_CHANNEL = "pro.periscop.child/location"
        const val DIAG_CHANNEL = "pro.periscop.child/diag"
        const val SIGNAL_CHANNEL = "pro.periscop.child/signal"
        // Отдельный engine для headless-изолята фонового сервиса. UI-Activity
        // держит свой engine через FlutterActivity — они не пересекаются.
        const val BG_ENGINE_ID = "periscop_bg_location_engine"
        const val DART_ENTRYPOINT = "locationEntryPoint"
        const val DART_LIBRARY_URI = "package:periscop_child/background/location_entry.dart"
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val ACTION_HEARTBEAT = "ACTION_HEARTBEAT"
        // Activity Recognition transitions — шлются ActivityTransitionReceiver'ом
        // в этот сервис через startForegroundService(intent).
        const val ACTION_ACTIVITY_STILL = "ACTION_ACTIVITY_STILL"
        const val ACTION_ACTIVITY_MOVING = "ACTION_ACTIVITY_MOVING"

        /**
         * Можно ли поднимать сервис из автоматических точек (BootReceiver,
         * heartbeat-будильник, Activity Recognition). Без разрешения на
         * геолокацию startForeground(type=location) на Android 14+ роняет
         * процесс; на отвязанном устройстве сервис бесполезен — копил бы
         * точки, которые некуда отправить. Явный запуск из UI сюда не ходит.
         */
        fun canAutoStart(ctx: Context): Boolean {
            val perm = ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED ||
                ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
            return perm && !NativeCreds.isUnlinked(ctx)
        }
        private const val WAKE_LOCK_TAG = "periscop:LocationForegroundService"
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
        //   ACCURACY_GATE_HEARTBEAT_M — более мягкий для heartbeat (раз в 90 с).
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

        // v0.63.0 — Activity Recognition шлёт «STILL ENTER» и на светофоре, и в
        // пробке (журнал: велосипед/машина → STILL через 2 мин → 14 мин поездки
        // грубыми точками без GPS). Поэтому STILL от AR применяем, только если
        // движения по скорости/датчику не было столько времени.
        private const val AR_STILL_GRACE_MS = 3 * 60_000L

        // v0.63.0 — страховка на случай, когда AR движение не заметил: в STILL
        // точка (даже грубая, от Wi-Fi/вышек — GPS для этого не нужен) дальше
        // max(200 м, 2×accuracy) от места стоянки дважды подряд = ребёнок уехал.
        private const val STILL_ESCAPE_MIN_M = 200f
        private const val STILL_ESCAPE_CONFIRMATIONS = 2

        // v0.59.0 — офлайн-накопление. Без интернета в ACTIVE точки всё так же
        // снимаются каждые 5 с, но FLP копит их (в GPS-чипе, если он умеет
        // batching) и отдаёт пачкой раз в OFFLINE_BATCH_DELAY_MS: процессор и
        // Dart-изолят просыпаются в ~24 раза реже, а отправлять всё равно
        // некуда — точки лягут в очередь и уйдут, когда появится сеть.
        // В STILL не копим: там и так точка раз в минуту, а speed из неё нужен
        // сразу, чтобы заметить начало движения.
        private const val OFFLINE_BATCH_DELAY_MS = 2 * 60_000L
        // Сеть «моргает» (лифт, переход Wi-Fi → мобильная) — подписку FLP
        // пересоздаём, только если состояние продержалось. Появление сети
        // применяем быстрее: накопленные точки нужны родителю сразу.
        private const val NETWORK_OFFLINE_DEBOUNCE_MS = 20_000L
        private const val NETWORK_ONLINE_DEBOUNCE_MS = 3_000L

        // v0.31.2 — текущий профиль экспозится Dart-стороне через SharedPreferences.
        // UI-engine читает эти prefs через MainActivity MethodChannel и рендерит
        // chip-индикатор на home-экране ребёнка.
        const val PREFS_NAME = "periscop_location_state"
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

    // v0.63.0 — место, где телефон перешёл в STILL (см. maybeEscapeStill), и
    // счётчик точек подряд, ушедших от него дальше порога.
    private var stillAnchorLat: Double? = null
    private var stillAnchorLon: Double? = null
    private var stillEscapeHits: Int = 0
    private val applyArStill = Runnable { onArStill() }

    // v0.59.0 — есть ли интернет (INTERNET + VALIDATED) и копит ли текущая
    // подписка FLP точки пачками (setMaxUpdateDelayMillis).
    private var online: Boolean = true
    private var subscribedBatched: Boolean = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }
    private val applyNetworkState = Runnable { onNetworkStateSettled() }

    private fun log(msg: String) = DiagLog.write(this, "svc", msg)
    private fun logErr(msg: String, e: Throwable) =
        DiagLog.write(this, "svc", "$msg: ${e.javaClass.simpleName}: ${e.message}")

    override fun onCreate() {
        super.onCreate()
        log("onCreate")
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
        ensureBackgroundEngine()
        // v0.57: realtime-канал команд живёт вместе с FGS геолокации.
        ChildRealtimeClient.start(this)
        // v0.60.0: настройки журнала — один раз за процесс, в фоновом потоке.
        DiagConfigSync.fetchOnce(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        log("onStartCommand action=${intent?.action} flags=$flags startId=$startId")
        when (intent?.action) {
            ACTION_STOP -> {
                stopAll()
                return START_NOT_STICKY
            }
            ACTION_HEARTBEAT -> {
                // AlarmManager разбудил нас — нужен promote в foreground,
                // иначе на Android 12+ startForegroundService без startForeground
                // в 5 сек = ANR. Если сервис уже живой, повторный startForeground
                // безопасен.
                if (!promoteForeground("heartbeat")) return START_NOT_STICKY
                if (!ensureStarted("heartbeat")) return START_NOT_STICKY
                if (callback != null && subscribedBatched) {
                    // v0.59.0: без сети в движении FLP сам копит точки каждые
                    // 5 с — heartbeat лишь будил бы Dart-изолят, а realtime-
                    // каналу всё равно некуда подключаться.
                    log("heartbeat tick: offline, FLP batching — skip")
                } else {
                    handleHeartbeat()
                    // v0.57: страховка realtime-канала — поднять упавший / порвать «тихий».
                    ChildRealtimeClient.ensureConnected(this)
                }
                // Перепланируем следующий alarm — делаем это всегда, в т.ч.
                // после ошибок lastLocation, иначе цепочка оборвётся.
                scheduleHeartbeatAlarm()
            }
            ACTION_ACTIVITY_STILL -> {
                // Activity Recognition сигналит «ребёнок неподвижен» →
                // переключаем FLP в still-профиль (interval=60с, minDist=30м),
                // но не сразу после движения — см. onArStill.
                // Сервис может быть ещё не started — promote в foreground
                // безопасен и идемпотентен.
                if (!promoteForeground("AR STILL")) return START_NOT_STICKY
                if (!ensureStarted("AR STILL")) return START_NOT_STICKY
                onArStill()
            }
            ACTION_ACTIVITY_MOVING -> {
                if (!promoteForeground("AR MOVING")) return START_NOT_STICKY
                if (!ensureStarted("AR MOVING")) return START_NOT_STICKY
                // Движение по AR — такой же сигнал, как скорость: отменяет
                // отложенный STILL и перезапускает 15-мин debounce.
                lastMovingTimeMs = System.currentTimeMillis()
                mainHandler.removeCallbacks(applyArStill)
                switchProfile(Profile.ACTIVE)
            }
            else -> start()
        }
        return START_STICKY
    }

    // v0.68.1 — система убила процесс, а первым его поднял не ACTION_START, а
    // heartbeat-будильник или сигнал Activity Recognition. Без этой проверки
    // сервис жил без подписки FLP: раз в 90 с отдавал старый lastLocation, и
    // маршрут пропадал до следующего открытия приложения (журнал 2026-09-30:
    // 10 минут пути без точек). false — start() не смог стартовать (нет
    // разрешения на геолокацию) и уже вызвал stopSelf.
    // Остановка целиком: и по ACTION_STOP из UI, и когда сервер отозвал токен.
    // Realtime-канал команд живёт вместе с FGS — без stop() он переподключался
    // со старым токеном раз в 10 минут бесконечно.
    private fun stopAll() {
        cancelHeartbeatAlarm()
        unregisterNetworkMonitor()
        unregisterActivityTransitions()
        motionMonitor.stop()
        ChildRealtimeClient.stop(this)
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // Будильник или AR подняли сервис через startForegroundService — promote
    // обязателен. Разрешение на геолокацию могли отозвать после того, как
    // receiver его проверил: тогда SecurityException, а не падение процесса.
    private fun promoteForeground(reason: String): Boolean {
        return try {
            startForeground(NOTIF_ID, buildNotification())
            true
        } catch (e: SecurityException) {
            logErr("$reason: startForeground denied (location permission revoked?)", e)
            stopAll()
            false
        }
    }

    private fun ensureStarted(reason: String): Boolean {
        if (callback != null) return true
        log("$reason: подписки FLP нет (новый процесс) — полный start()")
        start()
        return callback != null
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

    // Вызовы из headless-Dart в native по тому же каналу. Engine кэширован на
    // процесс и переживает экземпляр сервиса — поэтому только applicationContext
    // и intent, без ссылок на this.
    private fun registerLifecycleHandler(channel: MethodChannel) {
        val app = applicationContext
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "deviceUnlinked" -> {
                    DiagLog.write(app, "bg", "deviceUnlinked: token revoked → stop location service")
                    NativeCreds.markUnlinked(app)
                    try {
                        app.startService(
                            Intent(app, LocationForegroundService::class.java).setAction(ACTION_STOP),
                        )
                    } catch (e: Throwable) {
                        DiagLog.write(app, "bg", "deviceUnlinked: stop failed: ${e.message}")
                    }
                    result.success(null)
                }
                else -> result.notImplemented()
            }
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
            registerLifecycleHandler(bgChannel!!)
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
            registerLifecycleHandler(bgChannel!!)

            // Диагностический канал для headless-Dart: diagLog/diagDebug/diagUpload.
            DiagChannel.register(applicationContext, engine.dartExecutor.binaryMessenger, "bg")

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

            // pro.periscop.child/sound_around — тот же канал что и в MainActivity.
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
        // stop → start одной парой (баннер AR) может прийти в тот же экземпляр,
        // минуя onCreate: realtime, остановленный в stopAll, поднимаем здесь.
        ChildRealtimeClient.start(this)
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
        registerNetworkMonitor()
        subscribeLocationUpdates(initial)
        // Если стартуем в STILL — сразу регистрируем motion sensor для wake-on-motion.
        // (switchProfile сделает то же самое при переключении, но при первом
        // start() мы не вызываем switchProfile, поэтому делаем явно здесь.)
        if (initial == Profile.STILL) {
            val ok = motionMonitor.start()
            log("start: motion sensor register=$ok (initial STILL)")
        }
        // Heartbeat: шлём текущую точку раз в 90 с через AlarmManager.
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
        val batched = p == Profile.ACTIVE && !online
        val builder = LocationRequest.Builder(priority, interval)
            .setMinUpdateDistanceMeters(minDist)
            .setMinUpdateIntervalMillis(interval / 2)
        if (batched) builder.setMaxUpdateDelayMillis(OFFLINE_BATCH_DELAY_MS)
        val request = builder.build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                log("onLocationResult size=${result.locations.size} profile=$p")
                for (loc in result.locations) {
                    sendToDart(loc, heartbeat = false)
                }
            }
        }
        callback = cb
        subscribedBatched = batched
        try {
            fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
            log("requestLocationUpdates OK profile=$p interval=${interval}ms minDist=${minDist}m batched=$batched")
        } catch (e: SecurityException) {
            logErr("requestLocationUpdates SecurityException", e)
            stopSelf()
        }
    }

    /**
     * Пересоздать подписку FLP под профиль [p]. FLP не даёт менять параметры
     * на лету — только remove + request. Если текущая подписка копит точки
     * пачкой, сначала забираем накопленное (flushLocations): иначе
     * removeLocationUpdates выбросит до 2 минут трека.
     */
    private fun resubscribe(p: Profile) {
        val old = callback
        val oldBatched = subscribedBatched
        callback = null
        subscribedBatched = false
        if (old == null) {
            subscribeLocationUpdates(p)
            return
        }
        if (!oldBatched) {
            fused.removeLocationUpdates(old)
            subscribeLocationUpdates(p)
            return
        }
        fused.flushLocations().addOnCompleteListener { task ->
            if (!task.isSuccessful) logErr("flushLocations failed", task.exception ?: Exception("unknown"))
            fused.removeLocationUpdates(old)
            // Пока ждали flush, подписку мог уже пересоздать кто-то другой
            // (switchProfile, start) — тогда вторую не делаем.
            if (callback == null) subscribeLocationUpdates(profile)
        }
    }

    // v0.59.0 — слежение за интернетом для офлайн-накопления точек.
    private fun isOnlineNow(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return true
        val active = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun registerNetworkMonitor() {
        online = isOnlineNow()
        log("network: initial ${if (online) "ONLINE" else "OFFLINE"}")
        if (networkCallback != null) return
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = scheduleNetworkCheck()
            override fun onLost(network: Network) = scheduleNetworkCheck()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
                scheduleNetworkCheck()
        }
        try {
            cm.registerDefaultNetworkCallback(cb, mainHandler)
            networkCallback = cb
        } catch (e: Throwable) {
            // Без монитора живём как раньше: подписка без накопления.
            logErr("registerDefaultNetworkCallback failed", e)
        }
    }

    private fun unregisterNetworkMonitor() {
        mainHandler.removeCallbacks(applyNetworkState)
        val cb = networkCallback ?: return
        networkCallback = null
        try {
            (getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
                ?.unregisterNetworkCallback(cb)
        } catch (_: Throwable) {
            // ignore
        }
    }

    private fun scheduleNetworkCheck() {
        mainHandler.removeCallbacks(applyNetworkState)
        val delay = if (isOnlineNow()) NETWORK_ONLINE_DEBOUNCE_MS else NETWORK_OFFLINE_DEBOUNCE_MS
        mainHandler.postDelayed(applyNetworkState, delay)
    }

    private fun onNetworkStateSettled() {
        val now = isOnlineNow()
        if (now == online) return
        online = now
        log("network: ${if (now) "ONLINE" else "OFFLINE"} (profile=$profile)")
        val wantBatched = profile == Profile.ACTIVE && !online
        if (callback != null && wantBatched != subscribedBatched) {
            resubscribe(profile)
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

    /**
     * v0.63.0 — AR «STILL ENTER». Если по скорости/датчику ребёнок двигался
     * меньше AR_STILL_GRACE_MS назад — это светофор или пробка: откладываем
     * и перепроверяем, когда пауза наберётся. Новый сигнал движения
     * (AR MOVING) отложенную проверку снимает.
     */
    private fun onArStill() {
        mainHandler.removeCallbacks(applyArStill)
        val sinceMoving = System.currentTimeMillis() - lastMovingTimeMs
        if (lastMovingTimeMs == 0L || sinceMoving >= AR_STILL_GRACE_MS) {
            switchProfile(Profile.STILL)
            return
        }
        val wait = AR_STILL_GRACE_MS - sinceMoving
        log("AR STILL deferred: moved ${sinceMoving / 1000}s ago, recheck in ${wait / 1000}s")
        mainHandler.postDelayed(applyArStill, wait)
    }

    /**
     * v0.63.0 — выход из STILL по смещению. Страхует AR, который в транспорте
     * может молчать: в STILL приходят только дешёвые точки Wi-Fi/вышек, и по
     * ним видно, что ребёнок уже далеко от места стоянки.
     */
    private fun maybeEscapeStill(loc: android.location.Location) {
        if (profile != Profile.STILL) return
        val aLat = stillAnchorLat
        val aLon = stillAnchorLon
        if (aLat == null || aLon == null) {
            stillAnchorLat = loc.latitude
            stillAnchorLon = loc.longitude
            return
        }
        val acc = if (loc.hasAccuracy()) loc.accuracy else 50f
        val dist = haversineMeters(aLat, aLon, loc.latitude, loc.longitude)
        if (dist <= maxOf(STILL_ESCAPE_MIN_M, 2f * acc).toDouble()) {
            stillEscapeHits = 0
            return
        }
        stillEscapeHits++
        log("STILL escape candidate #$stillEscapeHits: ${"%.0f".format(dist)}m from anchor, acc=$acc")
        if (stillEscapeHits >= STILL_ESCAPE_CONFIRMATIONS) {
            lastMovingTimeMs = System.currentTimeMillis()
            switchProfile(Profile.ACTIVE)
            requestFreshLocationOnce()
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
        // Якорь для maybeEscapeStill — последняя отправленная точка (обычно
        // точная, из ACTIVE); если её нет, якорем станет первая точка в STILL.
        stillAnchorLat = if (newProfile == Profile.STILL) lastSentLat else null
        stillAnchorLon = if (newProfile == Profile.STILL) lastSentLon else null
        stillEscapeHits = 0
        if (newProfile == Profile.ACTIVE) mainHandler.removeCallbacks(applyArStill)
        // Снимаем текущий callback и подписываемся заново с новыми параметрами.
        resubscribe(newProfile)
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
                // v0.63.0: Transition API официально поддерживает WALKING/RUNNING,
                // а не ON_FOOT — подписываемся и на них, иначе пешую прогулку
                // замечаем только по смещению.
                DetectedActivity.WALKING to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                DetectedActivity.RUNNING to ActivityTransition.ACTIVITY_TRANSITION_ENTER,
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
        maybeEscapeStill(loc)

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
        // v0.59.0: окно считаем по времени фиксации (loc.time), а не по часам
        // доставки — офлайн FLP отдаёт точки пачкой раз в 2 минуты, и у всех
        // точек пачки «сейчас» одинаковое.
        // v0.63.0: только если телефон не сообщает движение. Раньше фильтр
        // работал и при ходьбе: пешеход проходит 30 м за ~20 с, и от прогулки
        // оставалась точка на 30 м — трек срезал углы по диагонали.
        val movingBySpeed = loc.hasSpeed() && loc.speed >= SPEED_STILL_MS
        if (!heartbeat && !movingBySpeed) {
            val lastLat = lastSentLat
            val lastLon = lastSentLon
            val dt = loc.time - lastSentTimeMs
            if (lastLat != null && lastLon != null && dt in 0 until DEDUP_WINDOW_MS) {
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
        lastSentTimeMs = loc.time
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
            "mobileOperator" to currentMobileOperator(),
            "recordedAt" to loc.time,
            // v0.63.0: координаты от приложения-«фейкового GPS» — сервер хранит
            // такую точку, но в маршрут и геозоны не пускает.
            "isMock" to isMockLocation(loc),
        )
        channel.invokeMethod("onLocation", payload)
    }

    private fun isMockLocation(loc: android.location.Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            loc.isMock
        } else {
            @Suppress("DEPRECATION")
            loc.isFromMockProvider
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
        unregisterNetworkMonitor()
        callback?.let { fused.removeLocationUpdates(it) }
        callback = null
        subscribedBatched = false
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
