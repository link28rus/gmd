package pro.periscop.child

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs

// v0.60.0 — журнал на сервере (docs/superpowers/specs/2026-09-29-child-diag-logs.md).
// Здесь только чистая логика без Android API: её покрывают JUnit-тесты
// (android/app/src/test/kotlin/pro/periscop/child/DiagLogicTest.kt).

/** Категории записей журнала и привязка тегов к ним. */
object DiagCategories {
    const val AUDIO = "audio"
    const val LOCATION = "location"
    const val REALTIME = "realtime"
    const val PUSH = "push"
    const val UPDATE = "update"
    const val SYSTEM = "system"
    const val OTHER = "other"

    val ALL: List<String> = listOf(AUDIO, LOCATION, REALTIME, PUSH, UPDATE, SYSTEM, OTHER)

    // Ключи — в нижнем регистре: Dart-теги пишутся по-разному ('SoundAround',
    // 'AudioCommandHandler'). Сверх таблицы спецификации добавлены теги,
    // которые реально встречаются в коде: sa_bg, soundaround,
    // audiocommandhandler (audio); fcm_registrar, rustore_push_registrar,
    // app_control_http (push — регистрация токенов и ack команд);
    // app_control_scheduler (system — планировщик фоновых задач).
    private val byTag: Map<String, String> = buildMap {
        listOf(
            "sound", "sound_around", "audio_trampoline", "signal",
            "sa_bg", "soundaround", "audiocommandhandler",
        ).forEach { put(it, AUDIO) }
        listOf("bg", "ingestor", "activity", "svc", "heartbeat-recv", "motion")
            .forEach { put(it, LOCATION) }
        put("realtime", REALTIME)
        listOf(
            "fcm", "rustore", "fcm_token_refresh_worker", "poll",
            "fcm_registrar", "rustore_push_registrar", "app_control_http",
        ).forEach { put(it, PUSH) }
        listOf("updates", "post_update_guard").forEach { put(it, UPDATE) }
        listOf(
            "boot", "restart", "admin", "escape", "escape_probe_worker", "native",
            "ui", "crash", "diag", "app_control_scheduler",
        ).forEach { put(it, SYSTEM) }
    }

    fun forTag(tag: String): String = byTag[tag.trim().lowercase()] ?: OTHER
}

/**
 * Настройки журнала для этого телефона. Приходят с сервера (DIAG_CONFIG по
 * мгновенному каналу или GET /child/diag/config), хранятся в SharedPreferences
 * ([DiagConfigStore]). Отсутствующие поля — значения по умолчанию,
 * неизвестные категории отбрасываются.
 */
data class DiagConfig(
    val send: Set<String> = DiagCategories.ALL.toSet(),
    val debug: Set<String> = emptySet(),
    /** Как пришло с сервера (ISO), null = бессрочно. */
    val debugUntil: String? = null,
    /** Разобранный debugUntil; при нечитаемой строке — 0 (подробный режим выключен). */
    val debugUntilMs: Long? = null,
    val logcat: Boolean = false,
    val snapshot: Boolean = true,
    val autoUpload: Boolean = true,
) {
    fun isDebugActive(category: String, nowMs: Long): Boolean {
        if (category !in debug) return false
        val until = debugUntilMs ?: return true
        return nowMs < until
    }

    fun toJson(): String = JSONObject().apply {
        put("send", JSONArray(DiagCategories.ALL.filter { it in send }))
        put("debug", JSONArray(DiagCategories.ALL.filter { it in debug }))
        put("debugUntil", debugUntil ?: JSONObject.NULL)
        put("logcat", logcat)
        put("snapshot", snapshot)
        put("autoUpload", autoUpload)
    }.toString()

    /** Одна строка для экрана /debug. */
    fun summary(nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val sendStr = if (send.containsAll(DiagCategories.ALL)) "всё" else
            DiagCategories.ALL.filter { it in send }.joinToString(",").ifEmpty { "ничего" }
        val activeDebug = DiagCategories.ALL.filter { isDebugActive(it, nowMs) }
        val debugStr = when {
            debug.isEmpty() -> "нет"
            activeDebug.isEmpty() -> "истёк"
            else -> {
                val until = debugUntilMs?.let {
                    " до " + DateTimeFormatter.ofPattern("dd.MM HH:mm")
                        .format(Instant.ofEpochMilli(it).atZone(zone))
                } ?: ""
                activeDebug.joinToString(",") + until
            }
        }
        return "отправка: $sendStr · подробно: $debugStr · logcat: ${yesNo(logcat)}" +
            " · снимок: ${yesNo(snapshot)} · авто: ${yesNo(autoUpload)}"
    }

    private fun yesNo(v: Boolean) = if (v) "да" else "нет"

    companion object {
        val DEFAULT = DiagConfig()

        fun parse(raw: String?): DiagConfig {
            if (raw.isNullOrBlank()) return DEFAULT
            val o = try {
                JSONObject(raw)
            } catch (_: Throwable) {
                return DEFAULT
            }
            val until = if (o.isNull("debugUntil")) null else o.optString("debugUntil").trim()
            val untilStr = until?.takeIf { it.isNotEmpty() }
            return DiagConfig(
                send = categories(o, "send") ?: DEFAULT.send,
                debug = categories(o, "debug") ?: DEFAULT.debug,
                debugUntil = untilStr,
                debugUntilMs = untilStr?.let { parseIsoMs(it) ?: 0L },
                logcat = o.optBoolean("logcat", DEFAULT.logcat),
                snapshot = o.optBoolean("snapshot", DEFAULT.snapshot),
                autoUpload = o.optBoolean("autoUpload", DEFAULT.autoUpload),
            )
        }

        /** null — поля нет / не массив (берём умолчание); пустой массив — пустое множество. */
        private fun categories(o: JSONObject, key: String): Set<String>? {
            val arr = o.optJSONArray(key) ?: return null
            val out = LinkedHashSet<String>()
            for (i in 0 until arr.length()) {
                val c = arr.optString(i).trim().lowercase()
                if (c in DiagCategories.ALL) out.add(c)
            }
            return out
        }

        fun parseIsoMs(s: String): Long? = try {
            Instant.parse(s).toEpochMilli()
        } catch (_: Throwable) {
            try {
                OffsetDateTime.parse(s).toInstant().toEpochMilli()
            } catch (_: Throwable) {
                null
            }
        }
    }
}

/** Фильтр текста журнала по категориям `send` перед отправкой. */
object DiagLogFilter {
    // Новый формат `MM-dd HH:mm:ss.SSS L [tag] msg` и старый (< 0.60.0)
    // `HH:mm:ss.SSS [tag] msg` — в файле после обновления лежат оба.
    private val HEADER = Regex("""^(?:\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}\.\d{3} (?:[A-Z] )?\[([^\]]*)]""")

    fun tagOf(line: String): String? = HEADER.find(line)?.groupValues?.get(1)

    /**
     * Строки без заголовка (продолжение многострочного сообщения — стек и т.п.)
     * идут вместе с предыдущей записью. Хвост до первой записи (обрезка файла)
     * считается категорией `other`.
     */
    fun filter(text: String, send: Set<String>): String {
        if (send.containsAll(DiagCategories.ALL)) return text
        if (send.isEmpty() || text.isEmpty()) return ""
        val sb = StringBuilder(text.length)
        var include = DiagCategories.OTHER in send
        val lines = text.split('\n')
        for ((i, line) in lines.withIndex()) {
            if (i == lines.lastIndex && line.isEmpty()) break
            val tag = tagOf(line)
            if (tag != null) include = DiagCategories.forTag(tag) in send
            if (include) sb.append(line).append('\n')
        }
        return sb.toString()
    }
}

/**
 * Лимит автоотправки: один trigger — не чаще раза в 30 мин, всего — не больше
 * 6 за скользящие сутки. История хранится в SharedPreferences JSON-массивом.
 * Записи «из будущего» (часы перевели назад) тоже считаются — иначе сменой
 * времени лимит обходится.
 */
object DiagAutoLimiter {
    const val PER_TRIGGER_INTERVAL_MS = 30 * 60_000L
    const val WINDOW_MS = 24 * 60 * 60_000L
    const val MAX_PER_WINDOW = 6

    data class Entry(val trigger: String, val atMs: Long)

    data class Decision(val allowed: Boolean, val history: List<Entry>, val reason: String)

    fun decide(history: List<Entry>, trigger: String, nowMs: Long): Decision {
        val recent = history.filter { abs(nowMs - it.atMs) < WINDOW_MS }
        if (recent.any { it.trigger == trigger && abs(nowMs - it.atMs) < PER_TRIGGER_INTERVAL_MS }) {
            return Decision(false, recent, "trigger_interval")
        }
        if (recent.size >= MAX_PER_WINDOW) return Decision(false, recent, "daily_limit")
        return Decision(true, recent + Entry(trigger, nowMs), "ok")
    }

    fun encode(history: List<Entry>): String = JSONArray().apply {
        history.forEach { put(JSONObject().put("t", it.trigger).put("at", it.atMs)) }
    }.toString()

    fun decode(raw: String?): List<Entry> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val t = o.optString("t")
                val at = o.optLong("at", -1L)
                if (t.isEmpty() || at < 0) null else Entry(t, at)
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }
}

/** Обрезка по байтам UTF-8 с сохранением хвоста (самое свежее — в конце). */
object DiagText {
    fun tailUtf8(text: String, maxBytes: Int): String {
        val bytes = text.toByteArray(Charsets.UTF_8)
        if (bytes.size <= maxBytes) return text
        var start = bytes.size - maxBytes
        // Не начинать с середины многобайтного символа (байты 10xxxxxx).
        while (start < bytes.size && (bytes[start].toInt() and 0xC0) == 0x80) start++
        return String(bytes, start, bytes.size - start, Charsets.UTF_8)
    }
}
