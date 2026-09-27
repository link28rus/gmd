package pro.periscop.parent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * v0.56.0 — результат PackageInstaller-сессии самообновления (см. [AppUpdater]).
 * exported=false: PendingIntent сессии адресован явно этому классу.
 */
class AppUpdateStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AppUpdater.ACTION_INSTALL_STATUS) return
        AppUpdater.onInstallStatus(context.applicationContext, intent)
    }
}
