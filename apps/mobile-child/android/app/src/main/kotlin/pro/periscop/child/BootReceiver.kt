package pro.periscop.child

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
//
// v0.56.0: MY_PACKAGE_REPLACED — установка обновления убивает процесс вместе
// с foreground-сервисом. После тихого самообновления (AppUpdater) никто не
// открывает UI, поэтому сервис поднимаем здесь, как после ребута.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != "com.htc.intent.action.QUICKBOOT_POWERON"
        ) return

        // v0.62.0: причина запуска — после неё prewarm микрофона из фона обычно
        // падает на Android 14+ (см. MicReadiness).
        DiagLog.write(
            context,
            "boot",
            "BootReceiver: received $action sdk=${Build.VERSION.SDK_INT} " +
                "importance=${DiagSnapshot.processImportance()} serviceState=${SoundAroundService.state}",
        )

        if (action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            try {
                AppUpdater.onPackageReplaced(context)
            } catch (e: Throwable) {
                DiagLog.write(context, "updates", "onPackageReplaced failed: ${e.message}")
            }
        }

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

        if (NativeCreds.isUnlinked(context)) {
            DiagLog.write(context, "boot", "BootReceiver: $action → SKIPPED (device unlinked)")
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

        // v0.36.0 D-lite: best-effort pre-warm SoundAroundService после ребута.
        // BootReceiver получает короткий FGS-start exemption от system, поэтому
        // startForeground(type=MICROPHONE) ИНОГДА проходит. Если crashes —
        // SoundAroundService.handlePrewarm логирует и stopSelf'ится, ничего страшного.
        // Юзер может открыть приложение для повторного prewarm через MainActivity.onCreate.
        // v0.60.0: подробности — под тегом "sound" (категория audio), чтобы
        // включались вместе с остальным путём «Звука вокруг».
        DiagLog.debug(
            context,
            "sound",
            "BootReceiver($action): prewarm dispatch, serviceState=${SoundAroundService.state} " +
                "importance=${DiagSnapshot.processImportance()} sdk=${Build.VERSION.SDK_INT}",
        )
        // ЭКСПЕРИМЕНТ 2026-09-30: если есть право «поверх других приложений»,
        // оно даёт background-activity-launch capability — запускаем видимую
        // MicWakeActivity автоматически, без тапа ребёнка. Видимая активность
        // должна дать службе WIU-доступ к микрофону (проверяем на эмуляторе).
        // v0.68.0 — автозапуск микрофона после перезагрузки БЕЗ участия ребёнка.
        // Подтверждено на эмуляторе Android 15 (curCapability включает M).
        //
        // Android 14+ не даёт микрофон службе, запущенной из фона; исходный prewarm
        // из BootReceiver стартует, но система молча снимает право (while-in-use).
        // Единственный «видимый» путь к микрофону без участия ребёнка — на долю
        // секунды показать активность: видимая активность = приложение на переднем
        // плане = while-in-use выдаётся (этот путь уже подтверждён тапом по
        // уведомлению в v0.62.0). Чтобы запустить активность из фонового
        // BootReceiver, нужно право «поверх других приложений» (SYSTEM_ALERT_WINDOW):
        // оно даёт background-activity-launch capability. Ребёнок выдаёт его один
        // раз при настройке; дальше после каждой перезагрузки активность
        // поднимается сама.
        //
        // Если права нет — молча откатываемся на prewarm ниже (микрофон включится
        // после того, как ребёнок откроет приложение или коснётся уведомления).
        // Подробности и статус проверки: docs/superpowers/specs/2026-09-30-sound-around-autostart.md
        if (android.provider.Settings.canDrawOverlays(context)) {
            try {
                val wake = Intent(context, MicWakeActivity::class.java)
                    .putExtra(MicWakeActivity.EXTRA_FROM, MicWakeActivity.FROM_BOOT)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(wake)
                DiagLog.write(context, "sound", "BootReceiver($action): MicWakeActivity авто-запуск (право overlay есть)")
            } catch (e: Throwable) {
                DiagLog.write(context, "sound", "BootReceiver: MicWakeActivity авто-запуск FAILED: ${e.javaClass.simpleName}: ${e.message}")
            }
        }

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
            DiagLog.debug(context, "sound", "BootReceiver: prewarm dispatch exception class=${e.javaClass.name}")
            MicReadiness.set(context, false, "BootReceiver($action): prewarm dispatch FAILED")
            MicReadiness.showBlockedNotification(context, "BootReceiver prewarm dispatch FAILED")
            DiagUpload.autoTrigger(context, DiagUpload.TRIGGER_PREWARM_FAILED)
        }
    }
}
