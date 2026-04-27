package ru.link28rus.gmd.child

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * v0.39 Phase 6.2 — App Blocking Core (mobile-child).
 *
 * Локальное состояние блокировки экрана ребёнка. Хранится в SharedPreferences
 * (Drift не нужен — данных мало: 2 поля для активной сессии + JSON-массив
 * правил ≤500 packages).
 *
 * **Read API:**
 *   - [isBlocked] — единственная функция, нужная AccessibilityService.
 *     Дёргается синхронно при каждом TYPE_WINDOW_STATE_CHANGED.
 *
 * **Write API (вызывают из FCM handler / poll worker):**
 *   - [setActiveBlock] / [clearActiveBlock] — синхронизация BlockSession
 *   - [setRules] — синхронизация AppRule после SYNC_RULES или /child/app-rules
 *
 * **Hardcoded whitelist** дублирован с backend (см. AppBlockingService.HARDCODED_ALLOWED).
 * Это безопасно: даже если backend почему-то не отдал правило, мы локально
 * не заблокируем наш собственный app — иначе ребёнок не сможет открыть
 * настройки и получить помощь от родителя.
 *
 * **Thread safety:** все методы synchronized — IO с SharedPreferences дешёвая
 * (~µs), conflict с FCM/worker маловероятен, но защищаемся.
 */
object BlockManager {
    private const val PREFS = "gmd_block_state"
    private const val KEY_ACTIVE_SESSION_ID = "active_session_id"
    private const val KEY_ACTIVE_ENDS_AT_MS = "active_ends_at_ms"
    private const val KEY_RULES_JSON = "rules_json"

    /** Зашиты намертво, не переопределяются ни PARENT, ни SYSTEM_DEFAULT правилами. */
    private val HARDCODED_ALLOWED = setOf(
        "ru.link28rus.gmd.child",
        "ru.oneme.app",
    )

    /** Системные packages, которые НИКОГДА не блокируются (безопасность ребёнка). */
    private val SAFETY_ALLOWED = setOf(
        "com.android.settings",         // нужно для grant'ов / решения проблем
        "com.android.systemui",          // SystemUI overlay (notifications, status bar)
        "com.android.phone",             // emergency dial
        "com.android.dialer",            // legacy default dialer
        "com.android.contacts",          // legacy contacts
        "com.android.emergency",         // emergency app (некоторые OEM)
        "com.android.incallui",          // активный звонок
        "com.android.server.telecom",
    )

    enum class Mode { DEFAULT, ALWAYS_ALLOWED, ALWAYS_BLOCKED }

    data class ActiveBlock(val sessionId: String, val endsAtMs: Long)

    @Synchronized
    fun setActiveBlock(ctx: Context, sessionId: String, endsAtMs: Long) {
        prefs(ctx).edit()
            .putString(KEY_ACTIVE_SESSION_ID, sessionId)
            .putLong(KEY_ACTIVE_ENDS_AT_MS, endsAtMs)
            .apply()
        DiagLog.write(ctx, TAG, "setActiveBlock id=${sessionId.take(8)}… endsAt=${java.util.Date(endsAtMs)}")
    }

    @Synchronized
    fun clearActiveBlock(ctx: Context, reason: String = "manual") {
        prefs(ctx).edit()
            .remove(KEY_ACTIVE_SESSION_ID)
            .remove(KEY_ACTIVE_ENDS_AT_MS)
            .apply()
        DiagLog.write(ctx, TAG, "clearActiveBlock reason=$reason")
        // v0.39.5: если overlay сейчас показан (например по UNBLOCK_APPS FCM или
        // expire) — убираем. Если активная сессия снята, но open app всё ещё
        // ALWAYS_BLOCKED — следующий a11y event поднимет overlay заново.
        OverlayManager.hide(ctx, "block-cleared:$reason")
    }

    /** Возвращает активную блок-сессию или null если истекла / нет. */
    @Synchronized
    fun getActiveBlock(ctx: Context): ActiveBlock? {
        val p = prefs(ctx)
        val id = p.getString(KEY_ACTIVE_SESSION_ID, null) ?: return null
        val endsAt = p.getLong(KEY_ACTIVE_ENDS_AT_MS, 0L)
        if (endsAt <= System.currentTimeMillis()) {
            // Истекла локально — чистим и возвращаем null. AccessibilityService
            // больше overlay не покажет; backend через cron тоже зачистит сессию
            // (ACTIVE → EXPIRED), parent UI обновится при следующем GET active.
            p.edit().remove(KEY_ACTIVE_SESSION_ID).remove(KEY_ACTIVE_ENDS_AT_MS).apply()
            DiagLog.write(ctx, TAG, "active block expired locally (id=${id.take(8)}…)")
            return null
        }
        return ActiveBlock(sessionId = id, endsAtMs = endsAt)
    }

    /**
     * Заменяет локальную таблицу правил целиком (FULL replace, не merge).
     * rules — список JSON-объектов вида {packageName, mode, source}.
     * Пустой массив = «правил нет, всё подчиняется DEFAULT» (= блокируется при
     * активной сессии, кроме HARDCODED + SAFETY_ALLOWED).
     */
    @Synchronized
    fun setRules(ctx: Context, rulesJson: JSONArray) {
        prefs(ctx).edit().putString(KEY_RULES_JSON, rulesJson.toString()).apply()
        DiagLog.write(ctx, TAG, "setRules count=${rulesJson.length()}")
    }

    /** Mode для конкретного package с учётом HARDCODED + SAFETY override'ов. */
    @Synchronized
    fun getEffectiveMode(ctx: Context, packageName: String): Mode {
        if (packageName in HARDCODED_ALLOWED) return Mode.ALWAYS_ALLOWED
        if (packageName in SAFETY_ALLOWED) return Mode.ALWAYS_ALLOWED

        val rulesStr = prefs(ctx).getString(KEY_RULES_JSON, null) ?: return Mode.DEFAULT
        val arr = try {
            JSONArray(rulesStr)
        } catch (_: Throwable) {
            return Mode.DEFAULT
        }
        // Линейный поиск: rules ≤500, вызывается при WINDOW_STATE_CHANGED (сотни раз
        // в день, не миллисекунд критично). Для оптимизации можно кэшировать в Map,
        // но на ~500 элементов выигрыш минимальный.
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            if (obj.optString("packageName") != packageName) continue
            return when (obj.optString("mode")) {
                "ALWAYS_ALLOWED" -> Mode.ALWAYS_ALLOWED
                "ALWAYS_BLOCKED" -> Mode.ALWAYS_BLOCKED
                else -> Mode.DEFAULT
            }
        }
        return Mode.DEFAULT
    }

    /**
     * Главный read-API для AccessibilityService.
     *
     * Логика:
     *   1) HARDCODED / SAFETY_ALLOWED → false (никогда не блокируем)
     *   2) Mode.ALWAYS_ALLOWED → false (явный whitelist)
     *   3) Mode.ALWAYS_BLOCKED → true (постоянно заблокировано, v0.40)
     *   4) Mode.DEFAULT → true только если есть активная BlockSession
     */
    @Synchronized
    fun isBlocked(ctx: Context, packageName: String): Boolean {
        val mode = getEffectiveMode(ctx, packageName)
        return when (mode) {
            Mode.ALWAYS_ALLOWED -> false
            Mode.ALWAYS_BLOCKED -> true
            Mode.DEFAULT -> getActiveBlock(ctx) != null
        }
    }

    @Synchronized
    fun applyRulesFromJsonObject(ctx: Context, body: JSONObject) {
        val rules = body.optJSONArray("rules") ?: JSONArray()
        setRules(ctx, rules)
    }

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private const val TAG = "block_manager"
}
