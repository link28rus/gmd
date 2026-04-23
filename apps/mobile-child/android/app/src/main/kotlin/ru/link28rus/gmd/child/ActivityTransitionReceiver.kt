package ru.link28rus.gmd.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionEvent
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Broadcast receiver для Activity Recognition transition-updates.
 *
 * Подписка регистрируется в [LocationForegroundService.registerActivityTransitions].
 * События приходят в виде pending-intent broadcast'а; ресивер парсит транзишены
 * и шлёт сервису intent о смене активности:
 *
 *  STILL_ENTER   → ACTION_ACTIVITY_STILL   (сервис уходит в still-профиль FLP)
 *  STILL_EXIT    → ACTION_ACTIVITY_MOVING  (обратно в active-профиль)
 *  IN_VEHICLE/ON_FOOT/ON_BICYCLE ENTER → ACTION_ACTIVITY_MOVING
 *
 * Если permission ACTIVITY_RECOGNITION не дан, сервис никогда не зарегистрирует
 * подписку — этот ресивер просто не будет получать события. Fallback — accuracy-gate
 * в сервисе отфильтровывает indoor-шум даже без adaptive-режима.
 */
class ActivityTransitionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_ACTIVITY_TRANSITION = "ru.link28rus.gmd.child.ACTIVITY_TRANSITION"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_ACTIVITY_TRANSITION) return
        if (!ActivityTransitionResult.hasResult(intent)) return
        val result = ActivityTransitionResult.extractResult(intent) ?: return

        for (event in result.transitionEvents) {
            DiagLog.write(
                context,
                "activity",
                "transition: ${activityName(event.activityType)} ${transitionName(event.transitionType)}",
            )
            handleEvent(context, event)
        }
    }

    private fun handleEvent(context: Context, event: ActivityTransitionEvent) {
        val serviceAction = when {
            event.activityType == DetectedActivity.STILL &&
                event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER ->
                LocationForegroundService.ACTION_ACTIVITY_STILL

            event.activityType == DetectedActivity.STILL &&
                event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_EXIT ->
                LocationForegroundService.ACTION_ACTIVITY_MOVING

            event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER &&
                event.activityType in MOVING_ACTIVITIES ->
                LocationForegroundService.ACTION_ACTIVITY_MOVING

            else -> null
        } ?: return

        val svcIntent = Intent(context, LocationForegroundService::class.java).setAction(serviceAction)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svcIntent)
            } else {
                context.startService(svcIntent)
            }
        } catch (e: Throwable) {
            DiagLog.write(
                context,
                "activity",
                "startService failed for $serviceAction: ${e.javaClass.simpleName}: ${e.message}",
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
