package pro.periscop.parent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * v0.56.0 — MY_PACKAGE_REPLACED: новая версия встала (см. [AppUpdater.onPackageReplaced]).
 * В mobile-child то же делает BootReceiver, который заодно поднимает
 * foreground-сервис геолокации; у родителя фоновых сервисов нет.
 */
class AppUpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        try {
            AppUpdater.onPackageReplaced(context)
        } catch (e: Throwable) {
            DiagLog.write(context, "updates", "onPackageReplaced failed: ${e.message}")
        }
    }
}
