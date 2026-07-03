package pro.periscop.child

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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

// Воспроизводит максимально громкий сигнал на телефоне ребёнка даже если
// пользователь выкрутил звук в ноль или включил Silent/DND.
//
// Ключевая механика:
//   1. Используем STREAM_ALARM — этот канал звучит в Silent/Vibrate режимах
//      (так же как будильник). DND по умолчанию пропускает alarm-звуки.
//   2. Принудительно поднимаем громкость STREAM_ALARM до максимума через
//      AudioManager.setStreamVolume — пользовательское значение запоминаем
//      и возвращаем в onDestroy.
//   3. MediaPlayer с USAGE_ALARM / CONTENT_TYPE_SONIFICATION:
//      — приоритетно играем бундлованный R.raw.signal_alarm — пронзительный
//        alarm-pattern (квадратные волны 2500/3500 Hz, фиксированная громкость
//        не зависит от рингтона пользователя);
//      — fallback на системный default alarm-рингтон, если raw-ресурс
//        не открылся (теоретически невозможно, но дешёвая страховка).
//   4. Параллельно включаем вибрацию — помогает если наушники воткнуты
//      или динамик чем-то прикрыт.
//   5. Автостоп через SIGNAL_DURATION_MS, чтобы не вогнать ребёнка в
//      паническую атаку и не сесть батарею.
//   6. Кнопка «Остановить» в foreground notification — чтобы ребёнок мог
//      сам заглушить раньше таймаута.
class SignalSoundService : Service() {
    companion object {
        const val ACTION_PLAY = "ACTION_PLAY_SIGNAL"
        const val ACTION_STOP = "ACTION_STOP_SIGNAL"
        const val CHANNEL_ID = "periscop_signal_channel"
        const val NOTIF_ID = 0xC2
        // 60 секунд — компромисс: достаточно чтобы ребёнок услышал и нашёл
        // телефон, не настолько долго чтобы стать инструментом для троллинга.
        private const val SIGNAL_DURATION_MS = 60_000L
    }

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var previousAlarmVolume: Int? = null
    private var audioManager: AudioManager? = null
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
            else -> startSignal()
        }
        return START_NOT_STICKY
    }

    private fun startSignal() {
        startForeground(NOTIF_ID, buildNotification())

        // 1. Принудительный max volume на STREAM_ALARM, запоминаем пред.
        val am = audioManager ?: return
        if (previousAlarmVolume == null) {
            previousAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        }
        val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        try {
            am.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0)
            log("set STREAM_ALARM to max=$maxVol (was $previousAlarmVolume)")
        } catch (e: SecurityException) {
            // На некоторых прошивках Xiaomi/Huawei с жёстким DND —
            // SecurityException. Проигрывание всё равно пробуем.
            log("setStreamVolume SecurityException: ${e.message}")
        }

        // 2. MediaPlayer: приоритет — бундлованный R.raw.signal_alarm.
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val rawUri: Uri = Uri.parse("android.resource://$packageName/${R.raw.signal_alarm}")
        var started = false
        try {
            val mp = MediaPlayer().apply {
                setAudioAttributes(attrs)
                setDataSource(this@SignalSoundService, rawUri)
                isLooping = true
                setVolume(1.0f, 1.0f)
                prepare()
                start()
            }
            mediaPlayer = mp
            started = true
            log("MediaPlayer started bundled signal_alarm")
        } catch (e: Throwable) {
            log("bundled signal_alarm failed: ${e.javaClass.simpleName}: ${e.message}")
        }
        if (!started) {
            // Fallback на системный alarm-рингтон.
            val alarmUri: Uri? =
                RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            if (alarmUri == null) {
                log("no alarm uri available — vibration only")
            } else {
                try {
                    val mp = MediaPlayer().apply {
                        setAudioAttributes(attrs)
                        setDataSource(this@SignalSoundService, alarmUri)
                        isLooping = true
                        setVolume(1.0f, 1.0f)
                        prepare()
                        start()
                    }
                    mediaPlayer = mp
                    log("MediaPlayer started fallback uri=$alarmUri")
                } catch (e: Throwable) {
                    log("fallback MediaPlayer failed: ${e.javaClass.simpleName}: ${e.message}")
                }
            }
        }

        // 3. Вибрация — непрерывный паттерн 500ms on / 300ms off на alarm-usage.
        try {
            val pattern = longArrayOf(0L, 500L, 300L)
            val vibAttrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = VibrationEffect.createWaveform(pattern, 0)
                vibrator?.vibrate(effect, vibAttrs)
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
            log("vibrator started")
        } catch (e: Throwable) {
            log("vibrator failed: ${e.message}")
        }

        // 4. Автостоп.
        stopHandler.removeCallbacks(stopRunnable)
        stopHandler.postDelayed(stopRunnable, SIGNAL_DURATION_MS)
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
        // Возвращаем исходную громкость STREAM_ALARM.
        previousAlarmVolume?.let { prev ->
            try {
                audioManager?.setStreamVolume(AudioManager.STREAM_ALARM, prev, 0)
                log("restored STREAM_ALARM volume to $prev")
            } catch (e: SecurityException) {
                log("restore volume SecurityException: ${e.message}")
            }
        }
        previousAlarmVolume = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        log("onDestroy")
        stopSelfSafe()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Сигнал от родителя",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Громкий сигнал, отправленный из кабинета родителя"
            // Никаких звуков канала — звуком управляет сам сервис через
            // MediaPlayer. Без этого Android может продублировать сигнал.
            setSound(null, null)
            enableVibration(false)
        }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): android.app.Notification {
        val stopIntent = Intent(this, SignalSoundService::class.java).setAction(ACTION_STOP)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val stopPi = PendingIntent.getService(this, 1, stopIntent, flags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Сигнал от родителя")
            .setContentText("Нажми, чтобы остановить")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(stopPi)
            .addAction(
                android.R.drawable.ic_media_pause,
                "Остановить",
                stopPi,
            )
            .build()
    }
}
