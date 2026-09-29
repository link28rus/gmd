package pro.periscop.parent

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
 * - `type`: GEOFENCE_ENTER / GEOFENCE_EXIT / GEOFENCE_MISSED / GEOFENCE_NO_DATA /
 *   SOS / LOW_BATTERY / CHILD_OFFLINE
 * - `childId`, `childName` (опционально)
 * - тип-специфичные поля (zoneId, zoneName, sosId, lat, lon, recordedAt,
 *   `deadline` «08:30» у GEOFENCE_MISSED / GEOFENCE_NO_DATA)
 * - `delayed` = "1" у GEOFENCE_ENTER/EXIT (v0.59.0), если событие старше 3 мин —
 *   текст строит [GeofenceNotificationText].
 *
 * Сервис строит нативный notification и кладёт его в один из каналов (default
 * events / sos с высокой важностью). Тап открывает MainActivity с extras
 * `fcm_type` / `deeplink_child_id` / `zone_id` — v0.66.0: Dart открывает ленту
 * зоны (GEOFENCE_*) или экран ребёнка (остальные).
 */
class ParentFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        private const val TAG = "PeriscopParentFcm"
        private const val CHANNEL_EVENTS = "periscop_parent_events"
        // v0.46.0+4: версионированный channel id. Android не позволяет менять
        // звук/вибрацию уже созданного channel — каждый раз когда меняем sos_siren.wav
        // или vibration pattern, бампим суффикс _v3, _v4 ... и удаляем старые
        // в `deleteNotificationChannel` ниже.
        private const val CHANNEL_SOS = "periscop_parent_sos_v3"
        private const val PREFS = "periscop_parent_fcm"
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
        val zoneId = data["zoneId"]
        // v0.66.0: у GEOFENCE_* — по паре ребёнок × зона (см. notificationId).
        val notificationId = GeofenceNotificationText.notificationId(type, deeplinkChildId, zoneId)
        // Тап → MainActivity: extras уходят в Dart через канал
        // pro.periscop.parent/push (getInitialPush / onPush).
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (!deeplinkChildId.isNullOrBlank()) {
                putExtra(MainActivity.EXTRA_CHILD_ID, deeplinkChildId)
            }
            if (!zoneId.isNullOrBlank()) {
                putExtra(MainActivity.EXTRA_ZONE_ID, zoneId)
            }
            putExtra(MainActivity.EXTRA_FCM_TYPE, type)
        }
        val pendingFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        // requestCode = id уведомления: с общим requestCode на тип FLAG_UPDATE_CURRENT
        // перезаписывал extras, и все уведомления вели туда же, куда последнее.
        val pi = PendingIntent.getActivity(this, notificationId, intent, pendingFlag)

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
        // v0.59.0: delayed=1 — событие старше 3 мин (точки пришли с опозданием),
        // в тексте показываем реальное время события из recordedAt.
        val delayed = data["delayed"] == "1"
        val recordedAt = data["recordedAt"]
        return when (type) {
            "GEOFENCE_ENTER" -> Render(
                title = if (zoneName != null) "Вход в зону «$zoneName»" else "Вход в зону",
                body = GeofenceNotificationText.body(
                    enter = true,
                    childName = childName,
                    zoneName = zoneName,
                    delayed = delayed,
                    recordedAtIso = recordedAt,
                ),
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_DEFAULT,
            )
            "GEOFENCE_EXIT" -> Render(
                title = if (zoneName != null) "Выход из зоны «$zoneName»" else "Выход из зоны",
                body = GeofenceNotificationText.body(
                    enter = false,
                    childName = childName,
                    zoneName = zoneName,
                    delayed = delayed,
                    recordedAtIso = recordedAt,
                ),
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_DEFAULT,
            )
            // v0.66.0: «не пришёл к сроку» — раньше их рисовал только мост
            // backend'а (FCM notification), теперь сами. data.deadline может
            // отсутствовать.
            "GEOFENCE_MISSED" -> Render(
                title = GeofenceNotificationText.missedTitle(childName, zoneName),
                body = GeofenceNotificationText.missedBody(
                    childName,
                    zoneName,
                    data["deadline"]?.takeIf { it.isNotBlank() },
                ),
                channelId = CHANNEL_EVENTS,
                importance = NotificationCompat.PRIORITY_DEFAULT,
            )
            "GEOFENCE_NO_DATA" -> Render(
                title = GeofenceNotificationText.noDataTitle(childName),
                body = GeofenceNotificationText.noDataBody(
                    childName,
                    zoneName,
                    data["deadline"]?.takeIf { it.isNotBlank() },
                ),
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
        nm.deleteNotificationChannel("periscop_parent_sos")
        nm.deleteNotificationChannel("periscop_parent_sos_v2")
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
