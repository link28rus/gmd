package pro.periscop.parent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * v0.73.0 — «Найти телефон»: громкий сигнал на телефоне родителя по кнопке
 * «Подать сигнал» в личном кабинете. Порт SignalSoundService приложения
 * ребёнка, поведение то же:
 *
 *  1. STREAM_ALARM — звучит в режимах «Без звука» / «Вибрация» (как будильник),
 *     DND по умолчанию пропускает будильники. Громкость STREAM_ALARM на время
 *     сигнала — максимум, прежняя возвращается при остановке.
 *  2. MediaPlayer USAGE_ALARM, по кругу R.raw.signal_alarm (тот же файл, что у
 *     ребёнка); не открылся — системная мелодия будильника.
 *  3. Вибрация параллельно.
 *  4. Автостоп через [SIGNAL_DURATION_MS]; «Остановить» в уведомлении.
 *
 * Отличия от ребёнка: свой канал уведомлений и тексты; тип FGS указывается
 * явно (mediaPlayback); если система не дала стать foreground (старт из фона
 * без исключения) — звук всё равно играет, а «Остановить» показывается обычным
 * уведомлением (процесс жив за счёт службы геолокации). Подтверждение
 * сигнала серверу ([FindPhoneSignal.ackAsync]) — только когда MediaPlayer
 * реально заиграл: веб пишет «Телефон звонит».
 */
class SignalSoundService : Service() {
    companion object {
        const val ACTION_PLAY = "pro.periscop.parent.signal.PLAY"
        const val ACTION_STOP = "pro.periscop.parent.signal.STOP"
        const val EXTRA_SIGNAL_ID = "signalId"
        const val CHANNEL_ID = "periscop_parent_find_phone"
        const val NOTIF_ID = 0xC2
        // 60 секунд — как у ребёнка: хватает, чтобы найти телефон по звуку.
        private const val SIGNAL_DURATION_MS = 60_000L
    }

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var previousAlarmVolume: Int? = null
    private var audioManager: AudioManager? = null
    private var isForeground = false
    private val stopHandler = Handler(Looper.getMainLooper())
    private val stopRunnable = Runnable {
        log("autostop triggered after $SIGNAL_DURATION_MS ms")
        stopSelfSafe()
    }

    private fun log(msg: String) = DiagLog.write(this, "signal", msg)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        log("onCreate")
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        log("onStartCommand action=${intent?.action}")
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelfSafe()
                return START_NOT_STICKY
            }
            else -> startSignal(intent?.getStringExtra(EXTRA_SIGNAL_ID))
        }
        return START_NOT_STICKY
    }

    private fun startSignal(signalId: String?) {
        // startForegroundService обязывает вызвать startForeground — делаем это
        // первым. Из фона без исключения Android 12+ бросит
        // ForegroundServiceStartNotAllowedException: тогда играем без
        // foreground-статуса, «Остановить» — обычным уведомлением.
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type)
            isForeground = true
        } catch (e: Throwable) {
            isForeground = false
            log("startForeground FAILED: ${e.javaClass.simpleName}: ${e.message} — обычное уведомление")
            try {
                (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .notify(NOTIF_ID, buildNotification())
            } catch (e2: Throwable) {
                log("notify FAILED: ${e2.javaClass.simpleName}: ${e2.message}")
            }
        }

        // 1. Принудительный max volume на STREAM_ALARM, запоминаем прежний.
        val am = audioManager ?: return
        if (previousAlarmVolume == null) {
            previousAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        }
        val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        try {
            am.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0)
            log("set STREAM_ALARM to max=$maxVol (was $previousAlarmVolume)")
        } catch (e: SecurityException) {
            // Некоторые прошивки Xiaomi/Huawei с жёстким DND — играем всё равно.
            log("setStreamVolume SecurityException: ${e.message}")
        }

        // 2. MediaPlayer: повторный сигнал во время звучащего — не перезапускаем.
        if (mediaPlayer == null) {
            mediaPlayer = startPlayer()
        }

        // 3. Вибрация — 500 мс / 300 мс по кругу, usage alarm.
        try {
            val pattern = longArrayOf(0L, 500L, 300L)
            val vibAttrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0), vibAttrs)
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
            log("vibrator started")
        } catch (e: Throwable) {
            log("vibrator failed: ${e.message}")
        }

        // 4. Автостоп (новый сигнал продлевает).
        stopHandler.removeCallbacks(stopRunnable)
        stopHandler.postDelayed(stopRunnable, SIGNAL_DURATION_MS)

        // 5. Сервер: «телефон звонит» — только если звук реально пошёл.
        if (!signalId.isNullOrBlank()) {
            if (mediaPlayer != null) {
                FindPhoneSignal.ackAsync(this, signalId)
            } else {
                log("signal ${signalId.take(8)}…: звук не запустился — ack не шлём")
            }
        }
    }

    private fun startPlayer(): MediaPlayer? {
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val rawUri: Uri = Uri.parse("android.resource://$packageName/${R.raw.signal_alarm}")
        try {
            val mp = newPlayer(attrs, rawUri)
            log("MediaPlayer started bundled signal_alarm")
            return mp
        } catch (e: Throwable) {
            log("bundled signal_alarm failed: ${e.javaClass.simpleName}: ${e.message}")
        }
        // Fallback на системную мелодию будильника.
        val alarmUri: Uri? =
            RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        if (alarmUri == null) {
            log("no alarm uri available — vibration only")
            return null
        }
        return try {
            val mp = newPlayer(attrs, alarmUri)
            log("MediaPlayer started fallback uri=$alarmUri")
            mp
        } catch (e: Throwable) {
            log("fallback MediaPlayer failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    private fun newPlayer(attrs: AudioAttributes, uri: Uri): MediaPlayer {
        val mp = MediaPlayer()
        try {
            mp.setAudioAttributes(attrs)
            mp.setDataSource(this, uri)
            mp.isLooping = true
            mp.setVolume(1.0f, 1.0f)
            mp.prepare()
            mp.start()
            return mp
        } catch (e: Throwable) {
            mp.release()
            throw e
        }
    }

    private fun stopSelfSafe() {
        log("stopSelfSafe")
        stopHandler.removeCallbacks(stopRunnable)
        try {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (e: Throwable) {
            log("mediaPlayer stop failed: ${e.message}")
        } finally {
            mediaPlayer = null
        }
        try {
            vibrator?.cancel()
        } catch (_: Throwable) {
            // ignore
        }
        previousAlarmVolume?.let { prev ->
            try {
                audioManager?.setStreamVolume(AudioManager.STREAM_ALARM, prev, 0)
                log("restored STREAM_ALARM volume to $prev")
            } catch (e: SecurityException) {
                log("restore volume SecurityException: ${e.message}")
            }
        }
        previousAlarmVolume = null
        if (isForeground) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            isForeground = false
        }
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIF_ID)
        } catch (_: Throwable) {
        }
        stopSelf()
    }

    override fun onDestroy() {
        log("onDestroy")
        stopSelfSafe()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Найти телефон",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Громкий сигнал по кнопке «Подать сигнал» в личном кабинете"
            // Звуком управляет сервис (MediaPlayer) — канал без звука,
            // иначе Android продублирует сигнал.
            setSound(null, null)
            enableVibration(false)
        }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, SignalSoundService::class.java).setAction(ACTION_STOP)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val stopPi = PendingIntent.getService(this, 1, stopIntent, flags)
        val body = "Телефон ищут из личного кабинета. Нажмите «Остановить»."

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Перископ: поиск телефона")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(stopPi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(android.R.drawable.ic_media_pause, "Остановить", stopPi)
            .build()
    }
}
