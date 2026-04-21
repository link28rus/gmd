package ru.link28rus.gmd.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

// Автозапуск foreground-сервиса после перезагрузки устройства. Без этого
// после ребута локации перестают идти до первого открытия приложения вручную.
// LOCKED_BOOT_COMPLETED — до разблокировки первым пользователем (FBE
// Direct Boot); обычный BOOT_COMPLETED — после разблокировки. Ловим оба, но
// запускаем сервис только один раз — дубль stopForeground/startForeground
// безопасен (Android сам склеит).
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != "com.htc.intent.action.QUICKBOOT_POWERON"
        ) return

        val svc = Intent(context, LocationForegroundService::class.java)
            .setAction(LocationForegroundService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svc)
        } else {
            context.startService(svc)
        }
    }
}
