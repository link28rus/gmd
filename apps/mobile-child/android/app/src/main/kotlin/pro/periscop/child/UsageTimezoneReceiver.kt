package pro.periscop.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class UsageTimezoneReceiver: BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when(intent.action) {
            Intent.ACTION_TIME_CHANGED -> NativeCreds.restartUsageClock(context)
            Intent.ACTION_TIMEZONE_CHANGED -> UsagePeriods.capture(context)
            else -> return
        }
        AppControlScheduler.runUsageNow(context)
        AppControlScheduler.syncNow(context)
    }
}
