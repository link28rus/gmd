package pro.periscop.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

// Ловит AlarmManager-alarm heartbeat'а, запланированный в
// LocationForegroundService. Бросает ACTION_HEARTBEAT на сервис — тот
// отправит текущую точку в Dart-изолят и перепланирует следующий alarm.
//
// Почему AlarmManager, а не Handler.postDelayed: на MIUI/Xiaomi Android
// замораживает main thread процесса даже при активном FGS — postDelayed
// перестаёт тикать сразу после swipe+restart. AlarmManager с RTC_WAKEUP
// пробивает Doze/frozen-state и гарантирует heartbeat-доставку.
class HeartbeatReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_HEARTBEAT = "pro.periscop.child.HEARTBEAT"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        DiagLog.write(context, "heartbeat-recv", "alarm fired: $action")
        val svc = Intent(context, LocationForegroundService::class.java)
            .setAction(LocationForegroundService.ACTION_HEARTBEAT)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc)
            } else {
                context.startService(svc)
            }
        } catch (e: Throwable) {
            DiagLog.write(
                context,
                "heartbeat-recv",
                "startForegroundService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }
}
