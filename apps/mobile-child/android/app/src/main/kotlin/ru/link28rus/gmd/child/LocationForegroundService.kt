package ru.link28rus.gmd.child

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.plugin.common.MethodChannel

class LocationForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "gmd_location_channel"
        const val NOTIF_ID = 0xC1
        const val METHOD_CHANNEL = "ru.link28rus.gmd.child/location"
        const val ENGINE_ID = "gmd_main_engine"
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
    }

    private lateinit var fused: FusedLocationProviderClient
    private lateinit var callback: LocationCallback

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY }
            else -> start()
        }
        return START_STICKY
    }

    private fun start() {
        startForeground(NOTIF_ID, buildNotification())
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L)
            .setMinUpdateDistanceMeters(5f)
            .setMinUpdateIntervalMillis(5_000L)
            .build()
        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (loc in result.locations) {
                    sendToDart(loc)
                }
            }
        }
        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            stopSelf()
        }
    }

    private fun sendToDart(loc: android.location.Location) {
        val engine = FlutterEngineCache.getInstance().get(ENGINE_ID) ?: return
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryLevel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it > 0 }
        val isCharging = bm.isCharging
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
            "recordedAt" to loc.time,
        )
        MethodChannel(engine.dartExecutor.binaryMessenger, METHOD_CHANNEL).invokeMethod("onLocation", payload)
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
        if (::callback.isInitialized) fused.removeLocationUpdates(callback)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
