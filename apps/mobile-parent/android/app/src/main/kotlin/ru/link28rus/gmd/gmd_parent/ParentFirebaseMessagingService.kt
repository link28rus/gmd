package ru.link28rus.gmd.gmd_parent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * v0.46: handler входящих FCM data-message для родителя.
 *
 * Бэкенд шлёт `data` payload (без `notification`) с полями:
 * - `type`: GEOFENCE_ENTER / GEOFENCE_EXIT / SOS / LOW_BATTERY / CHILD_OFFLINE
 * - `childId`, `childName` (опционально)
 * - тип-специфичные поля (zoneId, sosId, lat, lon, recordedAt)
 *
 * Сервис строит нативный notification с deeplink на /home/child/{id} и кладёт
 * его в один из каналов (default events / sos с высокой важностью).
 */
class ParentFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        private const val TAG = "GmdParentFcm"
        private const val CHANNEL_EVENTS = "gmd_parent_events"
        // v0.46.0+4: версионированный channel id. Android не позволяет менять
        // звук/вибрацию уже созданного channel — каждый раз когда меняем sos_siren.wav
        // или vibration pattern, бампим суффикс _v3, _v4 ... и удаляем старые
        // в `deleteNotificationChannel` ниже.
        private const val CHANNEL_SOS = "gmd_parent_sos_v3"
        private const val PREFS = "gmd_parent_fcm"
        private const val PENDING_TOKEN_KEY = "pending_token"
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        val type = data["type"] ?: return
        Log.i(TAG, "received type=$type from=${message.from}")

        ensureChannels()

        val (title, body, channelId, importance) = render(type, data) ?: return

        val deeplinkChildId = data["childId"]
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (!deeplinkChildId.isNullOrBlank()) {
                putExtra("deeplink_child_id", deeplinkChildId)
            }
            putExtra("fcm_type", type)
        }
        val pendingFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getActivity(this, type.hashCode(), intent, pendingFlag)

        val notif = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // TODO: бренд-иконка
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(importance)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Уникальный id на тип+childId, чтобы новый event не затирал предыдущий по тому же ребёнку.
        val notificationId = ("$type:${deeplinkChildId ?: "_"}").hashCode()
        nm.notify(notificationId, notif)
    }

    /**
     * Рендерит pair (title, body, channelId, importance) для каждого типа.
     * Возвращает null если type неизвестен — тогда notification не показываем.
     */
    private data class Render(
        val title: String,
        val body: String,
        val channelId: String,
        val importance: Int,
    )

    private fun render(type: String, data: Map<String, String>): Render? {
        val childName = data["childName"]?.takeIf { it.isNotBlank() } ?: "Ребёнок"
        val zoneName = data["zoneName"]?.takeIf { it.isNotBlank() }
        return when (type) {
            "GEOFENCE_ENTER" -> Render(
                title = if (zoneName != null) "Вход в зону «$zoneName»" else "Вход в зону",
                body = if (zoneName != null) {
                    "$childName вошёл в зону «$zoneName»."
                } else {
                    "$childName вошёл в одну из геозон."
                },
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_DEFAULT,
            )
            "GEOFENCE_EXIT" -> Render(
                title = if (zoneName != null) "Выход из зоны «$zoneName»" else "Выход из зоны",
                body = if (zoneName != null) {
                    "$childName вышел из зоны «$zoneName»."
                } else {
                    "$childName вышел из одной из геозон."
                },
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_DEFAULT,
            )
            "SOS" -> Render(
                title = "SOS!",
                body = "$childName отправил SOS-сигнал. Откройте приложение, чтобы увидеть координаты.",
                channelId = CHANNEL_SOS,
                importance = NotificationCompat.PRIORITY_MAX,
            )
            "LOW_BATTERY" -> Render(
                title = "Низкий заряд",
                body = "У $childName заряд телефона ниже 20%.",
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_LOW,
            )
            "CHILD_OFFLINE" -> Render(
                title = "Ребёнок не на связи",
                body = "Телефон $childName давно не выходил на связь.",
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_LOW,
            )
            else -> null
        }
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_EVENTS) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_EVENTS,
                    "События ребёнка",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Геозоны, низкий заряд, ребёнок offline"
                },
            )
        }
        if (nm.getNotificationChannel(CHANNEL_SOS) == null) {
            val sirenUri = Uri.parse(
                ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + packageName + "/" + R.raw.sos_siren,
            )
            val audioAttrs = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .build()
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_SOS,
                    "SOS",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Тревожный сигнал от ребёнка"
                    enableLights(true)
                    enableVibration(true)
                    // Длинный pulse-pattern — заметнее обычной нотификации.
                    vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600, 300, 600)
                    setSound(sirenUri, audioAttrs)
                },
            )
        }
        // Старые версии CHANNEL_SOS — удаляем, чтобы юзер не путался в
        // Settings → Notifications.
        nm.deleteNotificationChannel("gmd_parent_sos")
        nm.deleteNotificationChannel("gmd_parent_sos_v2")
    }

    /**
     * Сохраняем новый FCM-токен в SharedPreferences. Dart-сторона прочитает его
     * после login и пошлёт на бэкенд POST /parents/devices/fcm-token. Если в
     * момент onNewToken юзер ещё не залогинен — токен отправится при следующем
     * registerInBackground() вызове.
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "onNewToken len=${token.length}")
        val prefs: SharedPreferences = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(PENDING_TOKEN_KEY, token).apply()
    }
}
