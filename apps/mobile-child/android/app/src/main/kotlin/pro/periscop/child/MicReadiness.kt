package pro.periscop.child

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * v0.62.0 — готовность микрофона для «Звука вокруг»
 * (docs/superpowers/specs/2026-09-29-sound-around-mic-blocked.md).
 *
 * `micReady` = [SoundAroundService] в foreground-состоянии type=microphone
 * (prewarm или stream). Android 14+ не даёт поднять такую службу из фона —
 * после перезагрузки/самообновления она остаётся выключенной, пока ребёнок
 * не коснётся приложения. Поэтому:
 *   - состояние хранится в памяти процесса и в SharedPreferences (`commit()` —
 *     процесс могут убить сразу после записи);
 *   - каждая смена уходит на сервер кадром `{op:"status", micReady}` realtime-канала
 *     (и в каждом `hello`), чтобы родитель видел, что микрофон выключен;
 *   - при сбое показывается уведомление «Нажми, чтобы Перископ снова работал
 *     полностью» → тап открывает прозрачную [MicWakeActivity], которая из
 *     видимой активности поднимает prewarm.
 *
 * Новый процесс всегда стартует с `micReady=false`: служба прошлого процесса
 * умерла вместе с ним, пока prewarm не отработает заново.
 */
object MicReadiness {
    private const val TAG = "sound"
    private const val PREFS = "periscop_mic"
    private const val KEY_READY = "mic_ready"
    private const val KEY_READY_AT = "mic_ready_at"
    private const val KEY_READY_REASON = "mic_ready_reason"
    private const val KEY_NOTIF_SHOWN = "mic_notif_shown"
    private const val KEY_NOTIF_AT = "mic_notif_at"

    const val CHANNEL_ID = "periscop_mic_blocked"
    private const val NOTIFICATION_ID = 4712

    private const val REPORT_RETRY_DELAY_MS = 3_000L

    private val lock = Any()

    @Volatile
    private var loaded = false

    @Volatile
    private var ready = false

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun fmt(ms: Long): String =
        if (ms <= 0) "-" else SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(Date(ms))

    /**
     * Первое обращение в процессе: сохранённое `true` от прошлого процесса
     * недостоверно (служба умерла вместе с процессом) — сбрасываем в false.
     */
    private fun ensureLoaded(ctx: Context) {
        if (loaded) return
        var resetFromPersisted = false
        synchronized(lock) {
            if (loaded) return
            val p = prefs(ctx)
            if (p.getBoolean(KEY_READY, false)) {
                p.edit()
                    .putBoolean(KEY_READY, false)
                    .putLong(KEY_READY_AT, System.currentTimeMillis())
                    .putString(KEY_READY_REASON, "новый процесс")
                    .commit()
                resetFromPersisted = true
            }
            ready = false
            loaded = true
        }
        if (resetFromPersisted) {
            DiagLog.write(ctx, TAG, "micReady true→false (новый процесс: служба прошлого процесса не жива)")
        }
    }

    fun isReady(ctx: Context): Boolean {
        ensureLoaded(ctx)
        return ready
    }

    /**
     * Смена состояния. Лог, запись и кадр статуса — только при реальной смене;
     * при `true` уведомление «микрофон заблокирован» снимается в любом случае.
     */
    fun set(ctx: Context, value: Boolean, reason: String) {
        ensureLoaded(ctx)
        val changed: Boolean
        synchronized(lock) {
            changed = ready != value
            if (changed) {
                ready = value
                prefs(ctx).edit()
                    .putBoolean(KEY_READY, value)
                    .putLong(KEY_READY_AT, System.currentTimeMillis())
                    .putString(KEY_READY_REASON, reason)
                    .commit()
            }
        }
        if (changed) {
            DiagLog.write(ctx, TAG, "micReady ${!value}→$value ($reason)")
            ChildRealtimeClient.sendMicStatus(ctx, value)
        }
        if (value) cancelBlockedNotification(ctx, reason)
    }

    /** Строка для DiagSnapshot. */
    fun describe(ctx: Context): String {
        ensureLoaded(ctx)
        val p = prefs(ctx)
        return "$ready (с ${fmt(p.getLong(KEY_READY_AT, 0L))}, причина: " +
            "${p.getString(KEY_READY_REASON, null) ?: "-"})"
    }

    fun describeNotification(ctx: Context): String {
        val p = prefs(ctx)
        val shown = p.getBoolean(KEY_NOTIF_SHOWN, false)
        return "показано=$shown (изменено ${fmt(p.getLong(KEY_NOTIF_AT, 0L))})"
    }

    fun describeChannel(ctx: Context): String {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val appEnabled = nm.areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "уведомления приложения=$appEnabled"
        val ch = nm.getNotificationChannel(CHANNEL_ID) ?: return "канал не создан, уведомления приложения=$appEnabled"
        val chEnabled = ch.importance != NotificationManager.IMPORTANCE_NONE
        return "включён=${appEnabled && chEnabled} (приложение=$appEnabled, канал importance=${ch.importance})"
    }

    private fun ensureChannel(ctx: Context, nm: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Перископ — нужно действие",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Просьба коснуться уведомления, когда телефон не дал включить микрофон"
            setSound(null, null)
            enableVibration(false)
        }
        nm.createNotificationChannel(channel)
    }

    /** Уведомление «микрофон заблокирован»: тап → [MicWakeActivity]. */
    fun showBlockedNotification(ctx: Context, reason: String) {
        val app = ctx.applicationContext
        try {
            val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            ensureChannel(app, nm)
            val target = Intent(app, MicWakeActivity::class.java)
                .putExtra(MicWakeActivity.EXTRA_FROM, MicWakeActivity.FROM_NOTIFICATION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            val tap = PendingIntent.getActivity(app, NOTIFICATION_ID, target, flags)
            val notification = NotificationCompat.Builder(app, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Перископ")
                .setContentText("Нажми, чтобы Перископ снова работал полностью")
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            nm.notify(NOTIFICATION_ID, notification)
            prefs(app).edit()
                .putBoolean(KEY_NOTIF_SHOWN, true)
                .putLong(KEY_NOTIF_AT, System.currentTimeMillis())
                .commit()
            DiagLog.write(
                app,
                TAG,
                "mic-blocked notification SHOWN ($reason) notificationsEnabled=${nm.areNotificationsEnabled()}",
            )
        } catch (e: Throwable) {
            DiagLog.write(app, TAG, "mic-blocked notification FAILED ($reason): ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    fun cancelBlockedNotification(ctx: Context, reason: String) {
        val app = ctx.applicationContext
        val p = prefs(app)
        if (!p.getBoolean(KEY_NOTIF_SHOWN, false)) return
        try {
            val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIFICATION_ID)
        } catch (_: Throwable) {
            /* уже снято */
        }
        p.edit()
            .putBoolean(KEY_NOTIF_SHOWN, false)
            .putLong(KEY_NOTIF_AT, System.currentTimeMillis())
            .commit()
        DiagLog.write(app, TAG, "mic-blocked notification CANCELLED ($reason)")
    }

    /** Отметить, что тап по уведомлению снял его (setAutoCancel). */
    fun onNotificationTapped(ctx: Context) {
        val app = ctx.applicationContext
        prefs(app).edit()
            .putBoolean(KEY_NOTIF_SHOWN, false)
            .putLong(KEY_NOTIF_AT, System.currentTimeMillis())
            .commit()
    }

    /**
     * Сбой START_AUDIO из-за запрета микрофона: сообщить серверу сразу, чтобы
     * родитель не ждал 45 с. Фоновый поток, один повтор при сетевой/5xx ошибке.
     */
    fun reportMicBlocked(ctx: Context, sessionId: String, message: String) {
        if (sessionId.isEmpty()) return
        val app = ctx.applicationContext
        val msg = message.take(450)
        Thread {
            for (attempt in 1..2) {
                val res = try {
                    AppControlHttp.postAudioSessionError(app, sessionId, "MIC_BLOCKED", msg)
                } catch (e: Throwable) {
                    AppControlHttp.Result(ok = false, statusCode = -1, bodyJson = null)
                }
                DiagLog.write(
                    app,
                    TAG,
                    "MIC_BLOCKED report session=${sessionId.take(8)}… attempt=$attempt → " +
                        "ok=${res.ok} status=${res.statusCode}",
                )
                // -1 — сеть/исключение, 5xx — сервер; 0 (нет creds) и 4xx повтор не лечит.
                val retryable = !res.ok && (res.statusCode == -1 || res.statusCode >= 500)
                if (!retryable || attempt == 2) break
                try {
                    Thread.sleep(REPORT_RETRY_DELAY_MS)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.apply { name = "periscop-mic-blocked-report" }.start()
    }
}
