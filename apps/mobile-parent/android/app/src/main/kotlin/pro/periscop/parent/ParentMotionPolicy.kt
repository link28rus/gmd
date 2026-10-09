package pro.periscop.parent

import java.util.Locale

/**
 * v0.77.0 — решение «в движении / на месте» для [ParentLocationService].
 *
 * Чистая логика без Android: перенос правил переключения профилей из
 * LocationForegroundService приложения ребёнка (maybeAutoSwitchProfile,
 * onArStill, maybeEscapeStill), чтобы покрыть их JUnit-тестами. Время —
 * любые монотонные миллисекунды (служба передаёт elapsedRealtime);
 * `lastMovingAtMs == 0` — движения ещё не было.
 *
 *  - скорость ≥ [SPEED_MOVING_MS] → ACTIVE сразу и отметка «двигались»;
 *  - в ACTIVE без движения дольше [STILL_DEBOUNCE_MS] (точка со скоростью
 *    ≤ [SPEED_STILL_MS] или без скорости) → STILL. Светофор и пробка короче —
 *    остаёмся в ACTIVE, трек не рвётся. Отличие от ребёнка: точка без
 *    скорости тоже считается «стоим» — у родителя в помещении FLP часто отдаёт
 *    точки Wi-Fi без скорости, и ACTIVE (GPS каждые 5 с) иначе не кончился бы;
 *  - AR «STILL» применяется, только если движения не было
 *    [AR_STILL_GRACE_MS]; иначе — перепроверить, когда пауза наберётся;
 *  - AR «движение» и датчик значимого движения → ACTIVE;
 *  - страховка в STILL: точка дальше max([STILL_ESCAPE_MIN_M], 2×accuracy) от
 *    места стоянки [STILL_ESCAPE_CONFIRMATIONS] раза подряд → ACTIVE.
 */
object ParentMotionPolicy {

    enum class Profile { ACTIVE, STILL }

    const val SPEED_MOVING_MS = 2.0f
    const val SPEED_STILL_MS = 0.5f
    const val STILL_DEBOUNCE_MS = 15 * 60_000L
    const val AR_STILL_GRACE_MS = 3 * 60_000L
    const val STILL_ESCAPE_MIN_M = 200f
    const val STILL_ESCAPE_CONFIRMATIONS = 2
    /** Точка без accuracy в проверке escape — как у ребёнка. */
    const val DEFAULT_ACCURACY_M = 50f

    /**
     * Итог события.
     *
     * @property profile профиль после события.
     * @property reason причина смены профиля для DiagLog; null — профиль тот же.
     * @property lastMovingAtMs обновлённое время последнего движения.
     * @property escapeHits счётчик точек подряд далеко от места стоянки.
     * @property recheckInMs > 0 — AR «STILL» отложен, перепроверить через столько.
     */
    data class Decision(
        val profile: Profile,
        val reason: String?,
        val lastMovingAtMs: Long,
        val escapeHits: Int = 0,
        val recheckInMs: Long = 0L,
    )

    /** Новая точка Fused Location: переключение по скорости. */
    fun onLocation(
        profile: Profile,
        hasSpeed: Boolean,
        speedMs: Float,
        nowMs: Long,
        lastMovingAtMs: Long,
        escapeHits: Int = 0,
    ): Decision {
        if (hasSpeed && speedMs >= SPEED_MOVING_MS) {
            return if (profile == Profile.STILL) {
                Decision(
                    Profile.ACTIVE,
                    "скорость ${fmt(speedMs)} м/с ≥ $SPEED_MOVING_MS",
                    nowMs,
                )
            } else {
                Decision(profile, null, nowMs, escapeHits)
            }
        }
        if (profile == Profile.ACTIVE && (!hasSpeed || speedMs <= SPEED_STILL_MS) &&
            lastMovingAtMs > 0L && nowMs - lastMovingAtMs > STILL_DEBOUNCE_MS
        ) {
            val speed = if (hasSpeed) "${fmt(speedMs)} м/с" else "нет скорости"
            return Decision(
                Profile.STILL,
                "без движения ${(nowMs - lastMovingAtMs) / 1000} с ($speed)",
                lastMovingAtMs,
            )
        }
        return Decision(profile, null, lastMovingAtMs, escapeHits)
    }

    /** Activity Recognition: STILL ENTER. */
    fun onArStill(profile: Profile, nowMs: Long, lastMovingAtMs: Long): Decision {
        if (profile == Profile.STILL) return Decision(profile, null, lastMovingAtMs)
        val since = nowMs - lastMovingAtMs
        if (lastMovingAtMs == 0L || since >= AR_STILL_GRACE_MS) {
            return Decision(Profile.STILL, "AR: неподвижен", lastMovingAtMs)
        }
        return Decision(
            profile,
            null,
            lastMovingAtMs,
            recheckInMs = AR_STILL_GRACE_MS - since,
        )
    }

    /** AR «движение» (STILL EXIT, IN_VEHICLE/ON_FOOT/… ENTER) или датчик движения. */
    fun onMoving(profile: Profile, nowMs: Long, source: String): Decision =
        if (profile == Profile.STILL) {
            Decision(Profile.ACTIVE, source, nowMs)
        } else {
            Decision(profile, null, nowMs)
        }

    /**
     * Точка в STILL относительно места стоянки (страховка, если AR молчит).
     * [accuracyM] null — точка без accuracy.
     */
    fun onStillPoint(
        profile: Profile,
        distanceFromAnchorM: Double,
        accuracyM: Float?,
        escapeHits: Int,
        nowMs: Long,
        lastMovingAtMs: Long,
    ): Decision {
        if (profile != Profile.STILL) return Decision(profile, null, lastMovingAtMs)
        val acc = accuracyM ?: DEFAULT_ACCURACY_M
        val threshold = maxOf(STILL_ESCAPE_MIN_M, 2f * acc).toDouble()
        if (distanceFromAnchorM <= threshold) return Decision(profile, null, lastMovingAtMs, 0)
        val hits = escapeHits + 1
        if (hits >= STILL_ESCAPE_CONFIRMATIONS) {
            return Decision(
                Profile.ACTIVE,
                "уехал от места стоянки: ${distanceFromAnchorM.toInt()} м, acc=${acc.toInt()} м, " +
                    "$hits раза подряд",
                nowMs,
            )
        }
        return Decision(profile, null, lastMovingAtMs, hits)
    }

    private fun fmt(v: Float): String = String.format(Locale.US, "%.1f", v)
}
