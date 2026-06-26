package ru.link28rus.gmd.child

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

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

        // v0.50.2 — permission gate. На Android 14+ (targetSdk=34) запуск
        // foregroundServiceType=location ТРЕБУЕТ granted ACCESS_*_LOCATION,
        // иначе ActivityThread бросает SecurityException и приложение
        // крашится при boot. Это происходит на чистой установке ДО claim
        // flow (юзер ещё не дал permissions через UI). Кейс детектится
        // модератором RuStore при первом запуске → отказ модерации.
        //
        // Если permission ещё не выдан — тихо логируем и НЕ стартуем сервис.
        // После того как пользователь пройдёт claim+permission flow в UI,
        // сервис будет запущен из MainActivity. На следующем boot'е этот
        // receiver уже найдёт granted permission и стартанёт сервис.
        val hasLocationPerm = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED

        if (!hasLocationPerm) {
            DiagLog.write(
                context,
                "boot",
                "BootReceiver: $action → SKIPPED (no ACCESS_*_LOCATION granted yet, " +
                    "claim flow ещё не пройден; сервис стартанёт после permission grant из UI)",
            )
            return
        }

        DiagLog.write(context, "boot", "BootReceiver: $action → startForegroundService")
        val svc = Intent(context, LocationForegroundService::class.java)
            .setAction(LocationForegroundService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svc)
        } else {
            context.startService(svc)
        }

        // v0.50.4 (lesson #24): UpdateCheckScheduler удалён — auto-update
        // полностью через `flutter_rustore_update` SDK на Dart-слое.

        // v0.36.0 D-lite: best-effort pre-warm SoundAroundService после ребута.
        // BootReceiver получает короткий FGS-start exemption от system, поэтому
        // startForeground(type=MICROPHONE) ИНОГДА проходит. Если crashes —
        // SoundAroundService.handlePrewarm логирует и stopSelf'ится, ничего страшного.
        // Юзер может открыть приложение для повторного prewarm через MainActivity.onCreate.
        try {
            val prewarmIntent = Intent(context, SoundAroundService::class.java)
                .putExtra(SoundAroundService.EXTRA_MODE, SoundAroundService.MODE_PREWARM)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(prewarmIntent)
            } else {
                context.startService(prewarmIntent)
            }
            DiagLog.write(context, "boot", "BootReceiver: SoundAroundService pre-warm dispatched")
        } catch (e: Throwable) {
            DiagLog.write(
                context,
                "boot",
                "BootReceiver: pre-warm SoundAroundService FAILED: " +
                    "${e.javaClass.simpleName}: ${e.message} (юзер откроет app для prewarm)",
            )
        }
    }
}
