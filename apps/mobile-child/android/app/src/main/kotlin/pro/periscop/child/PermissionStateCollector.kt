package pro.periscop.child

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Только чтение текущего OS-state; разрешения из фона не запрашиваем. */
object PermissionStateCollector {
    fun collect(ctx: Context): Map<String, Boolean?> {
        fun granted(permission: String) = ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED
        fun check(block: () -> Boolean): Boolean? = try { block() } catch (e: Exception) {
            DiagLog.write(ctx, "permissions", "check unavailable: ${e.javaClass.simpleName}")
            null
        }
        return PermissionSnapshot.normalize(Build.VERSION.SDK_INT, mapOf(
            "accessibility" to check { AppControlNative.isAccessibilityServiceEnabled(ctx) && PeriscopAccessibilityService.isConnected() },
            "usageStats" to check { AppControlNative.hasUsageStatsPermission(ctx) },
            "deviceAdmin" to check { (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager)
                .isAdminActive(ChildDeviceAdminReceiver.componentName(ctx)) },
            "overlay" to check { Settings.canDrawOverlays(ctx) },
            "notifications" to check { NotificationManagerCompat.from(ctx).areNotificationsEnabled() },
            "locationForeground" to check { granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION) },
            "locationBackground" to check { Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION) },
            "batteryUnrestricted" to check { (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName) },
            "microphone" to check { granted(Manifest.permission.RECORD_AUDIO) },
            "activityRecognition" to check { Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACTIVITY_RECOGNITION) },
            "installPackages" to check { ctx.packageManager.canRequestPackageInstalls() },
        ))
    }
}
