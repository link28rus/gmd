package pro.periscop.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

// Ловит AlarmManager-alarm, поставленный в LocationForegroundService.onTaskRemoved,
// и перезапускает foreground-сервис после свайпа приложения из recents.
// Без этого Android убивает процесс и не гарантирует рестарт по START_STICKY
// (особенно на MIUI/Huawei/Oppo — там sticky игнорируется).
// Broadcast от setExactAndAllowWhileIdle даёт short-term exemption
// от FGS-restrictions на Android 12+, поэтому startForegroundService здесь
// разрешён даже в background state.
class RestartReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_RESTART = "pro.periscop.child.RESTART_SERVICE"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        DiagLog.write(context, "restart", "RestartReceiver: $action → startForegroundService")
        val svc = Intent(context, LocationForegroundService::class.java)
            .setAction(LocationForegroundService.ACTION_START)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc)
            } else {
                context.startService(svc)
            }
        } catch (e: Throwable) {
            DiagLog.write(context, "restart", "startForegroundService FAILED: ${e.javaClass.simpleName}: ${e.message}")
        }
    }
}
