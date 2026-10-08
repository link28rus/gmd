package pro.periscop.parent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * v0.70.0 — будильник из [ParentLocationService.onTaskRemoved]: поднять службу
 * после свайпа приложения из «Недавних» (как RestartReceiver у ребёнка).
 */
class ParentLocationRestartReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_RESTART = "pro.periscop.parent.location.RESTART"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_RESTART) return
        ParentLocationService.ensureStarted(context, "task-removed", fromBackground = true)
    }
}
