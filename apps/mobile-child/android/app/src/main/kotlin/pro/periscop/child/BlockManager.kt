package pro.periscop.child

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
    private const val PREFS = "periscop_block_state"
    private const val KEY_ACTIVE_SESSION_ID = "active_session_id"
    private const val KEY_ACTIVE_ENDS_AT_MS = "active_ends_at_ms"
    private const val KEY_RULES_JSON = "rules_json"
    // v0.49 Phase 6.x — расписание автоблокировки (FCM SYNC_SCHEDULES).
    private const val KEY_SCHEDULES_JSON = "schedules_json"

    /** Зашиты намертво, не переопределяются ни PARENT, ни SYSTEM_DEFAULT правилами. */
    private val HARDCODED_ALLOWED = setOf(
        "pro.periscop.child",
        "ru.oneme.app",
    )

    /**
     * Системные packages, которые НИКОГДА не блокируются (безопасность + UX).
     *
     * Включает:
     *   - emergency dial / phone / dialer / contacts / incall — звонки 112,
     *     медпомощь, контакт родителя.
     *   - settings / systemui — иначе ребёнок не может ни откатить grant'ы,
     *     ни увидеть статусбар / notifications.
     *   - системные плагины SystemUI на MIUI/HyperOS, иначе блочится notification panel.
     *   - системный поиск (mi.appfinder) — выезжает свайпом со home.
     *   - install/permissions/services контроллеры.
     *
     * Launcher (`com.miui.home`, `com.android.launcher3`, etc.) НЕ хардкодим
     * — детектим динамически через PackageManager (см. [getLauncherPackages]).
     * Это покрывает все OEM'ы (Samsung OneUI, Pixel Launcher, Nova и т.д.) +
     * сторонние лаунчеры ребёнка.
     */
    private val SAFETY_ALLOWED = setOf(
        // Phone / emergency
        "com.android.settings",
        "com.android.systemui",
        "com.android.phone",
        "com.android.dialer",
        "com.android.contacts",
        "com.android.emergency",
        "com.android.incallui",
        "com.android.server.telecom",
        // MIUI / HyperOS system
        "com.miui.systemui.plugin",
        "miui.systemui.plugin",
        "com.miui.securitycenter",
        "com.miui.notification",
        "com.miui.system",
        "com.miui.contentextension",
        "com.android.miui.home",
        "com.mi.appfinder",            // системный «выдвижной» поиск свайпом по home
        "com.miui.global.packageinstaller",
        "com.android.packageinstaller",
        // Generic Android
        "com.google.android.permissioncontroller",
        "android",
    )

    /**
     * Cached список launcher packages (`Intent.CATEGORY_HOME` → `queryIntentActivities`).
     * Заполняется при первом обращении к [isBlocked] / [getEffectiveMode].
     * Сбрасывается при подозрении что launcher сменился (см. [refreshSystemSafety]).
     *
     * Включает ВСЕ установленные на устройстве launchers (default + альтернативные).
     * Это критично для UX: после клика «Закрыть» в blocking overlay'е ребёнок
     * попадает на launcher через `ACTION_HOME` → a11y фиксирует переключение →
     * launcher тоже должен быть allowed, иначе цикл «overlay → home → overlay → home»
     * и ребёнок не может выбраться из своего же launcher'а.
     */
    @Volatile
    private var cachedLaunchers: Set<String>? = null

    enum class Mode { DEFAULT, ALWAYS_ALLOWED, ALWAYS_BLOCKED }

    data class ActiveBlock(val sessionId: String, val endsAtMs: Long)

    /**
     * Активное расписание + момент окончания текущего временного окна.
     * Используется AccessibilityService чтобы показать overlay с countdown'ом
     * до конца окна, а не до конца «всего расписания» (расписание повторяется).
     */
    data class ActiveSchedule(
        val scheduleId: String,
        val name: String,
        val endsAtMs: Long,
    )

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
        // На случай если ребёнок поставил новый launcher между rules sync'ами.
        refreshSystemSafety()
    }

    /**
     * Все launcher packages на устройстве (default + альтернативные).
     * Кэшируется, refresh — через [refreshSystemSafety].
     */
    private fun getLauncherPackages(ctx: Context): Set<String> {
        cachedLaunchers?.let { return it }
        val intent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_HOME) }
        val pkgs = try {
            ctx.applicationContext.packageManager
                .queryIntentActivities(intent, 0)
                .map { it.activityInfo.packageName }
                .toSet()
        } catch (_: Throwable) {
            emptySet()
        }
        cachedLaunchers = pkgs
        DiagLog.write(ctx, TAG, "launchers detected: $pkgs")
        return pkgs
    }

    /**
     * Сбросить кэш launcher'ов. Вызывается:
     *   - При [setRules] (на всякий случай — может user поставил новый launcher
     *     между запусками а мы кэш не инвалидировали).
     */
    fun refreshSystemSafety() {
        cachedLaunchers = null
    }

    /** Mode для конкретного package с учётом HARDCODED + SAFETY override'ов. */
    @Synchronized
    fun getEffectiveMode(ctx: Context, packageName: String): Mode {
        if (packageName in HARDCODED_ALLOWED) return Mode.ALWAYS_ALLOWED
        if (packageName in SAFETY_ALLOWED) return Mode.ALWAYS_ALLOWED
        // Launcher (любой установленный) — никогда не блокируем, иначе ребёнок
        // не может попасть на home screen (close-button overlay'я ведёт сюда).
        if (packageName in getLauncherPackages(ctx)) return Mode.ALWAYS_ALLOWED

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
     *   4) Mode.DEFAULT → true если активна BlockSession ИЛИ активно расписание (v0.49)
     */
    @Synchronized
    fun isBlocked(ctx: Context, packageName: String): Boolean {
        val mode = getEffectiveMode(ctx, packageName)
        return when (mode) {
            Mode.ALWAYS_ALLOWED -> false
            Mode.ALWAYS_BLOCKED -> true
            Mode.DEFAULT -> getActiveBlock(ctx) != null || getActiveSchedule(ctx) != null
        }
    }

    @Synchronized
    fun applyRulesFromJsonObject(ctx: Context, body: JSONObject) {
        val rules = body.optJSONArray("rules") ?: JSONArray()
        setRules(ctx, rules)
    }

    // ─── v0.49 Phase 6.x — расписание автоблокировки ───────────────────────

    /**
     * Заменить локальный список расписаний целиком (FULL replace).
     * `schedulesJson` — массив объектов вида backend ScheduleDto:
     *   {id, name, enabled, daysMask, startMin, endMin, mode, …}
     */
    @Synchronized
    fun setSchedules(ctx: Context, schedulesJson: JSONArray) {
        prefs(ctx).edit().putString(KEY_SCHEDULES_JSON, schedulesJson.toString()).apply()
        DiagLog.write(ctx, TAG, "setSchedules count=${schedulesJson.length()}")
    }

    @Synchronized
    fun applySchedulesFromJsonObject(ctx: Context, body: JSONObject) {
        val arr = body.optJSONArray("schedules") ?: JSONArray()
        setSchedules(ctx, arr)
    }

    /**
     * Загруженный список расписаний (parsed). Пустой если SYNC_SCHEDULES ещё
     * не приходил или JSON повреждён.
     */
    @Synchronized
    fun getSchedules(ctx: Context): List<ScheduleEvaluator.Schedule> {
        val raw = prefs(ctx).getString(KEY_SCHEDULES_JSON, null) ?: return emptyList()
        val arr = try {
            JSONArray(raw)
        } catch (_: Throwable) {
            return emptyList()
        }
        return ScheduleEvaluator.parseFromJsonArray(arr)
    }

    /**
     * Первое активное расписание сейчас (или null). Активность вычисляется
     * через [ScheduleEvaluator.isActiveAt] в TZ устройства
     * (`TimeZone.getDefault().id` — обычно совпадает с TZ ребёнка).
     *
     * `endsAtMs` — момент окончания текущего временного окна (для overlay
     * countdown). После окончания окна следующий tick перепроверит и снимет
     * overlay, если новое окно ещё не началось.
     */
    @Synchronized
    fun getActiveSchedule(ctx: Context): ActiveSchedule? {
        val list = getSchedules(ctx)
        if (list.isEmpty()) return null
        val nowMs = System.currentTimeMillis()
        val tzId = java.util.TimeZone.getDefault().id
        val active = ScheduleEvaluator.firstActive(list, nowMs, tzId) ?: return null
        val endMs = ScheduleEvaluator.windowEndMs(active, nowMs, tzId)
        return ActiveSchedule(scheduleId = active.id, name = active.name, endsAtMs = endMs)
    }

    /**
     * Combined «когда закончится текущая блокировка» — максимум из
     * (BlockSession.endsAtMs, активное расписание endsAtMs) или 0 если оба null.
     *
     * Используется AccessibilityService и OverlayManager для countdown'а.
     */
    @Synchronized
    fun getCurrentBlockEndsAtMs(ctx: Context): Long {
        val active = getActiveBlock(ctx)?.endsAtMs ?: 0L
        val schedule = getActiveSchedule(ctx)?.endsAtMs ?: 0L
        return maxOf(active, schedule)
    }

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private const val TAG = "block_manager"
}
