package pro.periscop.parent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * v0.56.0 — MY_PACKAGE_REPLACED: новая версия встала (см. [AppUpdater.onPackageReplaced]).
 *
 * v0.70.0 — заодно автозапуск фоновой геолокации родителя
 * ([ParentLocationService]): после установки обновления (процесс убит вместе со
 * службой, UI никто не открывает) и после перезагрузки (BOOT_COMPLETED /
 * QUICKBOOT_POWERON). Служба стартует, только если есть токен, флаг включён и
 * выдано «Разрешать всегда» — см. [ParentLocationService.ensureStarted].
 * Как BootReceiver у mobile-child.
 */
class AppUpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            try {
                AppUpdater.onPackageReplaced(context)
            } catch (e: Throwable) {
                DiagLog.write(context, "updates", "onPackageReplaced failed: ${e.message}")
            }
        } else if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }
        try {
            ParentLocationService.ensureStarted(context, action.substringAfterLast('.'), fromBackground = true)
        } catch (e: Throwable) {
            DiagLog.write(context, "ploc", "autostart($action) failed: ${e.message}")
        }
    }
}
