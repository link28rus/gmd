package pro.periscop.child

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * v0.60.0 — снимок состояния телефона для журнала на сервере (текст
 * `ключ: значение`). Каждый пункт независим: сбой одного не ломает остальные.
 */
object DiagSnapshot {

    fun build(ctx: Context, extra: Map<String, String> = emptyMap()): String {
        val sb = StringBuilder()
        fun line(key: String, value: () -> Any?) {
            val v = try {
                value()?.toString() ?: "null"
            } catch (e: Throwable) {
                "ошибка: ${e.javaClass.simpleName}: ${e.message}"
            }
            sb.append(key).append(": ").append(v).append('\n')
        }

        val now = System.currentTimeMillis()
        line("время") { SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS Z", Locale.US).format(Date(now)) }
        line("часовой пояс") { TimeZone.getDefault().id }
        extra.forEach { (k, v) -> line(k) { v } }

        line("устройство") { "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})" }
        line("прошивка") { Build.DISPLAY }
        line("Android") { "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})" }
        line("приложение") { appVersion(ctx) }
        line("targetSdk") { ctx.applicationInfo.targetSdkVersion }
        line("процесс") {
            val upSec = (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()) / 1000
            "pid=${Process.myPid()} работает ${upSec}с, importance=${processImportance()}"
        }

        line("RECORD_AUDIO") { perm(ctx, Manifest.permission.RECORD_AUDIO) }
        line("ACCESS_FINE_LOCATION") { perm(ctx, Manifest.permission.ACCESS_FINE_LOCATION) }
        line("ACCESS_BACKGROUND_LOCATION") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                perm(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            } else {
                "n/a"
            }
        }
        line("POST_NOTIFICATIONS") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perm(ctx, Manifest.permission.POST_NOTIFICATIONS)
            } else {
                "n/a"
            }
        }
        line("уведомления включены") {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .areNotificationsEnabled()
        }
        line("ACTIVITY_RECOGNITION") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                perm(ctx, Manifest.permission.ACTIVITY_RECOGNITION)
            } else {
                "n/a"
            }
        }

        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        line("игнор оптимизации батареи") { pm.isIgnoringBatteryOptimizations(ctx.packageName) }
        line("энергосбережение") { pm.isPowerSaveMode }
        line("doze (device idle)") { pm.isDeviceIdleMode }
        line("экран включён") { pm.isInteractive }
        line("батарея") {
            val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            "${bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)}%, заряжается=${bm.isCharging}"
        }
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        line("фоновые ограничения (isBackgroundRestricted)") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) am.isBackgroundRestricted else "n/a"
        }
        line("standby bucket") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
                bucketName(usm.appStandbyBucket)
            } else {
                "n/a"
            }
        }
        line("сеть") { networkType(ctx) }

        line("LocationForegroundService") { serviceState(am, LocationForegroundService::class.java.name) }
        line("SoundAroundService") {
            "${serviceState(am, SoundAroundService::class.java.name)}, режим=${SoundAroundService.state}" +
                (SoundAroundService.lastFailure?.let { ", последний сбой: $it" } ?: "")
        }
        // v0.62.0: готовность микрофона и уведомление «микрофон заблокирован».
        line("micReady") { MicReadiness.describe(ctx) }
        line("уведомление «микрофон заблокирован»") { MicReadiness.describeNotification(ctx) }
        line("канал ${MicReadiness.CHANNEL_ID}") { MicReadiness.describeChannel(ctx) }
        line("мгновенный канал") { ChildRealtimeClient.describe() }
        line("Device Admin активен") {
            val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            dpm.isAdminActive(ChildDeviceAdminReceiver.componentName(ctx))
        }
        line("canRequestPackageInstalls") { ctx.packageManager.canRequestPackageInstalls() }
        line("DiagConfig") { DiagConfigStore.get(ctx).toJson() }
        return sb.toString()
    }

    fun processImportance(): String {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        val name = when (info.importance) {
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "foreground"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "fgs"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "perceptible"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE -> "service"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_CANT_SAVE_STATE -> "cant_save_state"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED -> "cached"
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE -> "gone"
            else -> "other"
        }
        return "${info.importance}/$name"
    }

    private fun perm(ctx: Context, p: String): String =
        if (ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED) "да" else "нет"

    // getRunningServices для своих сервисов работает и на новых Android.
    @Suppress("DEPRECATION")
    private fun serviceState(am: ActivityManager, className: String): String {
        val s = am.getRunningServices(200).firstOrNull {
            it.service.className == className && it.uid == Process.myUid()
        } ?: return "не запущен"
        return if (s.foreground) "работает (foreground)" else "работает (не foreground)"
    }

    private fun bucketName(b: Int): String = when (b) {
        UsageStatsManager.STANDBY_BUCKET_ACTIVE -> "ACTIVE"
        UsageStatsManager.STANDBY_BUCKET_WORKING_SET -> "WORKING_SET"
        UsageStatsManager.STANDBY_BUCKET_FREQUENT -> "FREQUENT"
        UsageStatsManager.STANDBY_BUCKET_RARE -> "RARE"
        45 -> "RESTRICTED"
        5 -> "EXEMPTED"
        50 -> "NEVER"
        else -> b.toString()
    } + " ($b)"

    private fun networkType(ctx: Context): String {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return "нет"
        val caps = cm.getNetworkCapabilities(net) ?: return "неизвестно"
        val type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
        val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        return "$type, validated=$validated, metered=${cm.isActiveNetworkMetered}"
    }

    @Suppress("DEPRECATION")
    private fun appVersion(ctx: Context): String {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode else pi.versionCode.toLong()
        return "${pi.versionName} ($code)"
    }
}
