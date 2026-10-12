package pro.periscop.child

/**
 * v0.82.0 — экономия батареи: срабатывание датчика движения в STILL больше не
 * включает GPS на 15+ минут, а запускает короткую «пробу».
 *
 * Журналы трёх детских телефонов (2026-10-10): почти каждый переход в STILL
 * через 5–10 с отменялся датчиком движения (MOTION_DETECT срабатывает сразу
 * после взвода), и HIGH_ACCURACY-GPS с точкой раз в 5 с горел часами, пока
 * телефон лежал. По точкам в БД «GPS на месте» разряжал 9–13 %/ч против
 * 5–6 %/ч в сетевом режиме.
 *
 * Чистые функции — покрыты MotionProbeTest (JVM, без Android).
 */
object MotionProbe {
    /** Сколько держать ACTIVE после срабатывания датчика без подтверждения. */
    const val PROBE_MS = 3 * 60_000L

    /** Задержка взвода датчика после входа в STILL; растёт после пустых проб. */
    const val ARM_DELAY_BASE_MS = 60_000L
    const val ARM_DELAY_MAX_MS = 5 * 60_000L

    /** Смещение за пробу, которое считается движением (пешком за 3 мин ~250 м). */
    const val MIN_DISPLACEMENT_M = 50.0

    /** 60 с, 2 мин, 4 мин, дальше 5 мин — после подряд идущих пустых проб. */
    fun armDelayMs(idleProbes: Int): Long {
        val shift = idleProbes.coerceIn(0, 3)
        return minOf(ARM_DELAY_BASE_MS shl shift, ARM_DELAY_MAX_MS)
    }

    /**
     * Было ли настоящее движение за пробу: скорость/AR/выход из стоянки после
     * срабатывания, либо телефон сместился дальше порога (с поправкой на
     * точность). Без якоря (ещё не было ни одной точки) судить не по чему —
     * считаем движением, чтобы не сломать трек.
     */
    fun isRealMovement(
        triggerAtMs: Long,
        lastRealMovementMs: Long,
        displacementM: Double?,
        accuracyM: Float?,
    ): Boolean {
        if (lastRealMovementMs >= triggerAtMs) return true
        if (displacementM == null) return true
        val threshold = maxOf(MIN_DISPLACEMENT_M, 2.0 * (accuracyM ?: 0f))
        return displacementM > threshold
    }
}
