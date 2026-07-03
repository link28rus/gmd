package pro.periscop.child

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.os.Build

/**
 * v0.40.3 — Wake-on-motion для мгновенного перехода STILL → ACTIVE.
 *
 * Зачем нужно: в STILL-профиле FLP-апдейты приходят раз в 60 секунд (interval)
 * с minDist=30м. Если ребёнок начал движение — мы узнаём это либо при следующем
 * FLP-апдейте (до 60с), либо через Activity Recognition (30-90с лаг). За это
 * время ребёнок уже мог проехать 1-2 км в машине, и трек на карте начинается
 * с разреженных точек.
 *
 * Решение: в STILL подписываемся на hardware motion-sensor (всё считается в
 * чипе телефона, CPU спит, расход батареи ~0%). Sensor срабатывает за 1-3 сек
 * с момента старта движения → forced switch ACTIVE → fresh GPS-fix через
 * `getCurrentLocation` → точка через 2-3 сек суммарно вместо 60 сек.
 *
 * **Приоритет sensor'ов** (берём первый доступный):
 *   1. `TYPE_MOTION_DETECT` (API 24+, type=30) — wake-up sensor, срабатывает
 *      когда устройство 5+ секунд в подтверждённом движении. Самый точный.
 *   2. `TYPE_SIGNIFICANT_MOTION` (API 18+, type=17) — wake-up trigger, срабатывает
 *      на «значительное движение» (одноразовое событие, нужно re-register).
 *      Поддерживается на 99%+ Android-устройств с 2014 года.
 *
 * **Graceful fallback:** если ни один sensor не доступен — `isSupported = false`,
 * вызовы [start] / [stop] no-op, остальная логика (speed-based switch +
 * Activity Recognition) работает как в v0.40.2.
 *
 * **Thread safety:** SensorManager callbacks приходят на main looper (если не
 * передавать другой Handler). [onMotionDetected] вызывается оттуда же — caller
 * должен быть готов к main thread (LocationForegroundService уже на main).
 */
class MotionSensorMonitor(
    ctx: Context,
    private val onMotionDetected: () -> Unit,
) {
    private val sm: SensorManager =
        ctx.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    /** Выбранный sensor (null если ничего не доступно). */
    private val sensor: Sensor? = pickBestSensor()

    /** Текущая активная подписка (для idempotent start/stop). */
    private var registered: Boolean = false

    /** Поддержан ли wake-on-motion на этом устройстве? */
    val isSupported: Boolean get() = sensor != null

    /** Человекочитаемое имя sensor'а для DiagLog. */
    val sensorLabel: String
        get() = sensor?.let {
            val typeName = when (it.type) {
                Sensor.TYPE_MOTION_DETECT -> "MOTION_DETECT(30)"
                Sensor.TYPE_SIGNIFICANT_MOTION -> "SIGNIFICANT_MOTION(17)"
                else -> "type=${it.type}"
            }
            val modeName = when (it.reportingMode) {
                Sensor.REPORTING_MODE_ONE_SHOT -> "one-shot"
                Sensor.REPORTING_MODE_ON_CHANGE -> "on-change"
                Sensor.REPORTING_MODE_CONTINUOUS -> "continuous"
                Sensor.REPORTING_MODE_SPECIAL_TRIGGER -> "special-trigger"
                else -> "mode=${it.reportingMode}"
            }
            "$typeName/$modeName"
        } ?: "NOT_SUPPORTED"

    private fun pickBestSensor(): Sensor? {
        // MOTION_DETECT (type 30) — API 24+, более точный (требует 5 сек подряд
        // движения для срабатывания → меньше false positive).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            sm.getDefaultSensor(Sensor.TYPE_MOTION_DETECT)?.let { return it }
        }
        // Fallback: SIGNIFICANT_MOTION (type 17) — API 18+, повсеместно
        // поддерживается. One-shot trigger (auto-unregister после срабатывания).
        return sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)
    }

    /**
     * SIGNIFICANT_MOTION использует TriggerEventListener (one-shot).
     * После срабатывания sensor автоматически unregister'ится — нам нужно
     * вызвать [start] заново для следующего trigger'а.
     */
    private val triggerListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            registered = false // sensor сам unregister'нулся после trigger'а
            onMotionDetected()
        }
    }

    /**
     * MOTION_DETECT использует обычный SensorEventListener (continuous).
     * После первого срабатывания мы сами unregister'имся (нам нужен только
     * первый event для switch в ACTIVE; дальше FLP сам даёт обновления).
     */
    private val eventListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent?) {
            if (event == null || event.values.isEmpty()) return
            // value[0] = 1.0 при детекции движения, 0.0 нет.
            // Документация: https://developer.android.com/reference/android/hardware/SensorEvent#values
            if (event.values[0] >= 0.5f) {
                stop() // unregister до switch чтобы не дёрнуть повторно
                onMotionDetected()
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
            // not used
        }
    }

    /**
     * Подписаться на motion sensor. Идемпотентно — повторный вызов без [stop]
     * не плодит подписок.
     *
     * @return true если подписка успешна (или уже была), false если sensor
     *         недоступен или система отказала.
     */
    fun start(): Boolean {
        if (registered) return true
        val s = sensor ?: return false
        // Выбираем API по reportingMode, не по type — на разных OEM один и тот
        // же sensor type может иметь разный mode. На POCO C71 MOTION_DETECT(30)
        // обнаружился как ONE_SHOT (flags=0x05), хотя AOSP-документация подразумевает
        // ON_CHANGE. requestTriggerSensor для one-shot, registerListener для остальных.
        return try {
            val ok = when (s.reportingMode) {
                Sensor.REPORTING_MODE_ONE_SHOT ->
                    sm.requestTriggerSensor(triggerListener, s)
                else ->
                    sm.registerListener(eventListener, s, SensorManager.SENSOR_DELAY_NORMAL)
            }
            registered = ok
            ok
        } catch (_: Throwable) {
            registered = false
            false
        }
    }

    /**
     * Отписаться. Безопасно вызывать дважды или без предшествующего [start].
     */
    fun stop() {
        if (!registered) return
        val s = sensor ?: return
        try {
            when (s.reportingMode) {
                Sensor.REPORTING_MODE_ONE_SHOT ->
                    sm.cancelTriggerSensor(triggerListener, s)
                else ->
                    sm.unregisterListener(eventListener)
            }
        } catch (_: Throwable) {
            // ignore — main goal is to not crash
        }
        registered = false
    }
}
