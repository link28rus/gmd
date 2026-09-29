package pro.periscop.child

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Общий диагностический лог для фонового сервиса + headless Dart-изолята.
// Kotlin единолично владеет файлом (synchronized write). UI читает его
// через MethodChannel из главного изолята, выводит на экране /debug.
// Назначение — диагностика без ADB (пользователь просто делает скриншот).
//
// v0.60.0: формат строки `MM-dd HH:mm:ss.SSS L [tag] msg` (L — I или D),
// подробные записи [debug] пишутся только для категорий, включённых в
// DiagConfig.debug; журнал уходит на сервер через [DiagUpload].
object DiagLog {
    private const val TAG = "periscop.diag"
    private const val FILE_NAME = "periscop-diag.log"
    private const val MAX_BYTES = 512_000L
    private const val TRUNCATE_TO_BYTES = 256_000
    private val lock = Any()
    // SimpleDateFormat не потокобезопасен — форматируем только под lock.
    private val timeFmt = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)

    fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    private fun redactTurnCreds(msg: String): String {
        // Замаскировать password/credential из JSON-подобных строк.
        return msg
            .replace(Regex("\"password\"\\s*:\\s*\"[^\"]*\""), "\"password\":\"***\"")
            .replace(Regex("\"credential\"\\s*:\\s*\"[^\"]*\""), "\"credential\":\"***\"")
            .replace(Regex("password=[^,\\s}]+"), "password=***")
            .replace(Regex("credential=[^,\\s}]+"), "credential=***")
            .replace(Regex("token=[^&,\\s}]+"), "token=***")
    }

    /** Обычная (INFO) запись — пишется всегда. */
    fun write(context: Context, tag: String, msg: String) = append(context, 'I', tag, msg)

    /** Подробная (DEBUG) запись — только если категория тега в активном DiagConfig.debug. */
    fun debug(context: Context, tag: String, msg: String) {
        if (!isDebugEnabled(context, tag)) return
        append(context, 'D', tag, msg)
    }

    /** Для дорогих сообщений: проверить до того, как собирать строку. */
    fun isDebugEnabled(context: Context, tag: String): Boolean = try {
        DiagConfigStore.get(context)
            .isDebugActive(DiagCategories.forTag(tag), System.currentTimeMillis())
    } catch (_: Throwable) {
        false
    }

    private fun append(context: Context, level: Char, tag: String, msg: String) {
        val safeMsg = redactTurnCreds(msg)
        synchronized(lock) {
            val line = "${timeFmt.format(Date())} $level [$tag] $safeMsg\n"
            if (level == 'D') Log.d(TAG, line.trimEnd()) else Log.i(TAG, line.trimEnd())
            try {
                val f = file(context)
                if (f.exists() && f.length() > MAX_BYTES) {
                    val bytes = f.readBytes()
                    var start = (bytes.size - TRUNCATE_TO_BYTES).coerceAtLeast(0)
                    // Начинаем с целой строки: пропускаем обрывок до первого '\n'.
                    val nl = (start until bytes.size).firstOrNull { bytes[it] == '\n'.code.toByte() }
                    if (nl != null) start = nl + 1
                    f.writeBytes(bytes.copyOfRange(start, bytes.size))
                }
                f.appendText(line)
            } catch (e: Throwable) {
                Log.e(TAG, "DiagLog.write failed", e)
            }
        }
    }

    fun readAll(context: Context): String {
        synchronized(lock) {
            return try {
                val f = file(context)
                if (f.exists()) f.readText() else ""
            } catch (e: Throwable) {
                Log.e(TAG, "DiagLog.readAll failed", e)
                ""
            }
        }
    }

    /** Журнал для отправки — только категории из `send`. */
    fun readForUpload(context: Context, send: Set<String>): String =
        DiagLogFilter.filter(readAll(context), send)

    fun clear(context: Context) {
        synchronized(lock) {
            try {
                file(context).writeText("")
            } catch (e: Throwable) {
                Log.e(TAG, "DiagLog.clear failed", e)
            }
        }
    }
}
