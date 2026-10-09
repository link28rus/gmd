package pro.periscop.parent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionEvent
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * v0.77.0 — события Activity Recognition для [ParentLocationService] (по
 * образцу ActivityTransitionReceiver приложения ребёнка).
 *
 * Подписку ставит служба (registerActivityTransitions). Ресивер переводит
 * переход в команду службе:
 *
 *  STILL ENTER → [ParentLocationService.ACTION_ACTIVITY_STILL]
 *  STILL EXIT, IN_VEHICLE/ON_FOOT/WALKING/RUNNING/ON_BICYCLE ENTER →
 *  [ParentLocationService.ACTION_ACTIVITY_MOVING]
 *
 * Отличие от ребёнка: службу событие НЕ поднимает. Если она не запущена в
 * этом процессе (подписка Play Services пережила смерть процесса), событие
 * пропускаем — поднимать службу из фона должны сторож и будильник с их
 * проверками разрешений, а не startForegroundService из ресивера.
 */
class ParentActivityTransitionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_ACTIVITY_TRANSITION = "pro.periscop.parent.location.ACTIVITY_TRANSITION"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_ACTIVITY_TRANSITION) return
        if (!ActivityTransitionResult.hasResult(intent)) return
        val result = ActivityTransitionResult.extractResult(intent) ?: return
        for (event in result.transitionEvents) {
            DiagLog.write(
                context,
                "ploc",
                "AR transition: ${activityName(event.activityType)} ${transitionName(event.transitionType)}",
            )
            handleEvent(context, event)
        }
    }

    private fun handleEvent(context: Context, event: ActivityTransitionEvent) {
        val action = when {
            event.activityType == DetectedActivity.STILL &&
                event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER ->
                ParentLocationService.ACTION_ACTIVITY_STILL

            event.activityType == DetectedActivity.STILL &&
                event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_EXIT ->
                ParentLocationService.ACTION_ACTIVITY_MOVING

            event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER &&
                event.activityType in MOVING_ACTIVITIES ->
                ParentLocationService.ACTION_ACTIVITY_MOVING

            else -> null
        } ?: return

        if (!ParentLocationService.running) {
            DiagLog.write(context, "ploc", "AR $action: служба не запущена — пропуск")
            return
        }
        try {
            // Служба уже работает как foreground — обычный startService
            // разрешён и не требует повторного startForeground.
            context.startService(
                Intent(context, ParentLocationService::class.java).setAction(action),
            )
        } catch (e: Throwable) {
            DiagLog.write(
                context,
                "ploc",
                "AR $action: startService FAILED: ${e.javaClass.simpleName}: ${e.message}",
            )
        }
    }

    private fun transitionName(t: Int): String = when (t) {
        ActivityTransition.ACTIVITY_TRANSITION_ENTER -> "ENTER"
        ActivityTransition.ACTIVITY_TRANSITION_EXIT -> "EXIT"
        else -> "UNKNOWN($t)"
    }

    private fun activityName(a: Int): String = when (a) {
        DetectedActivity.STILL -> "STILL"
        DetectedActivity.WALKING -> "WALKING"
        DetectedActivity.RUNNING -> "RUNNING"
        DetectedActivity.ON_FOOT -> "ON_FOOT"
        DetectedActivity.ON_BICYCLE -> "ON_BICYCLE"
        DetectedActivity.IN_VEHICLE -> "IN_VEHICLE"
        DetectedActivity.TILTING -> "TILTING"
        DetectedActivity.UNKNOWN -> "UNKNOWN"
        else -> "OTHER($a)"
    }
}

private val MOVING_ACTIVITIES = setOf(
    DetectedActivity.IN_VEHICLE,
    DetectedActivity.ON_FOOT,
    DetectedActivity.ON_BICYCLE,
    DetectedActivity.WALKING,
    DetectedActivity.RUNNING,
)
