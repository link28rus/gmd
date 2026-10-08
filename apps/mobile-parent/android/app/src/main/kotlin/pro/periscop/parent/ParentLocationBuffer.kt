package pro.periscop.parent

import android.content.Context
import java.io.File

/**
 * v0.73.1 — офлайн-буфер точек родителя («Найти телефон», защита от кражи).
 *
 * Файл JSONL в filesDir: одна точка — одна строка. Добавление — дописывание
 * строки (дёшево при любом размере), удаление отправленных — перезапись через
 * временный файл и rename (обрыв посередине не портит буфер).
 *
 * Ёмкость [MAX_POINTS]: служба пишет точку раз в 5 минут на месте и до раза в
 * минуту в движении — это 2+ недели непрерывной езды без сети (дольше хранить
 * незачем: сервер держит точки 30 дней). При переполнении НЕ выкидываем самые
 * старые (там место кражи), а прореживаем старшую половину через одну
 * ([thin]): маршрут остаётся целым на всём офлайн-отрезке, только реже.
 *
 * До v0.73.1 буфер (500 точек) лежал в SharedPreferences — при первом
 * обращении переносится сюда ([migrateLegacy]).
 *
 * Потокобезопасен (общий lock): пишет поток службы, считает и чистит UI.
 */
object ParentLocationBuffer {
    const val MAX_POINTS = 20_000
    private const val FILE_NAME = "parent_location_buffer.jsonl"
    private const val LEGACY_PREFS = "periscop_parent_location_buffer"
    private const val LEGACY_KEY = "points"

    private val lock = Any()
    /** Число строк в файле; null — ещё не считали. */
    private var cachedCount: Int? = null
    private var migrated = false

    private fun file(ctx: Context) = File(ctx.applicationContext.filesDir, FILE_NAME)

    fun append(ctx: Context, line: String) = synchronized(lock) {
        ensureReady(ctx)
        file(ctx).appendText(line.replace('\n', ' ') + "\n")
        val n = (cachedCount ?: 0) + 1
        cachedCount = n
        if (n > MAX_POINTS) {
            val kept = thin(readAllLocked(ctx), MAX_POINTS)
            writeAllLocked(ctx, kept)
            DiagLog.write(ctx, "ploc", "buffer: переполнение $n → прорежено до ${kept.size}")
        }
    }

    fun count(ctx: Context): Int = synchronized(lock) {
        ensureReady(ctx)
        cachedCount ?: 0
    }

    /** Первые [n] строк (самые старые). */
    fun peek(ctx: Context, n: Int): List<String> = synchronized(lock) {
        ensureReady(ctx)
        val f = file(ctx)
        if (!f.exists()) return emptyList()
        f.bufferedReader().useLines { seq -> seq.filter { it.isNotBlank() }.take(n).toList() }
    }

    /** Удалить первые [n] строк (отправлены или отвергнуты сервером). */
    fun dropFirst(ctx: Context, n: Int) {
        if (n <= 0) return
        synchronized(lock) {
            ensureReady(ctx)
            writeAllLocked(ctx, readAllLocked(ctx).drop(n))
        }
    }

    fun clear(ctx: Context) = synchronized(lock) {
        file(ctx).delete()
        cachedCount = 0
        // Старый буфер тоже: выход из аккаунта не должен оставить точки.
        ctx.applicationContext.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
            .edit().remove(LEGACY_KEY).commit()
        migrated = true
    }

    /**
     * Сжать [lines] до [cap]: из старшей половины выкинуть каждую вторую
     * точку, повторять, пока не влезет. Первая и последняя точки остаются.
     * Pure — покрыта ParentLocationBufferTest.
     */
    fun thin(lines: List<String>, cap: Int): List<String> {
        var cur = lines
        while (cur.size > cap && cur.size > 2) {
            val half = cur.size / 2
            val older = cur.subList(0, half).filterIndexed { i, _ -> i % 2 == 0 }
            val next = older + cur.subList(half, cur.size)
            if (next.size == cur.size) break
            cur = next
        }
        return if (cur.size > cap) cur.takeLast(cap) else cur
    }

    private fun ensureReady(ctx: Context) {
        if (!migrated) {
            migrated = true
            migrateLegacy(ctx)
        }
        if (cachedCount == null) {
            val f = file(ctx)
            cachedCount = if (f.exists()) {
                f.bufferedReader().useLines { seq -> seq.count { it.isNotBlank() } }
            } else {
                0
            }
        }
    }

    private fun migrateLegacy(ctx: Context) {
        val prefs = ctx.applicationContext.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(LEGACY_KEY, null) ?: return
        try {
            val arr = org.json.JSONArray(raw)
            val old = (0 until arr.length()).map { arr.get(it).toString() }
            // Старые точки — раньше всего, что уже могло лечь в файл.
            val existing = if (file(ctx).exists()) readAllLocked(ctx) else emptyList()
            writeAllLocked(ctx, old + existing)
            DiagLog.write(ctx, "ploc", "buffer: перенесено ${old.size} точек из SharedPreferences")
        } catch (e: Throwable) {
            DiagLog.write(ctx, "ploc", "buffer: старый буфер не прочитан: ${e.message}")
        }
        prefs.edit().remove(LEGACY_KEY).commit()
    }

    private fun readAllLocked(ctx: Context): List<String> {
        val f = file(ctx)
        if (!f.exists()) return emptyList()
        return f.readLines().filter { it.isNotBlank() }
    }

    private fun writeAllLocked(ctx: Context, lines: List<String>) {
        val f = file(ctx)
        val tmp = File(f.parentFile, "$FILE_NAME.tmp")
        tmp.bufferedWriter().use { w -> for (l in lines) { w.write(l); w.write("\n") } }
        if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
        }
        cachedCount = lines.size
    }
}
