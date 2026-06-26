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
object DiagLog {
    private const val TAG = "gmd.diag"
    private const val FILE_NAME = "gmd-diag.log"
    private const val MAX_BYTES = 200_000L
    private const val TRUNCATE_TO_BYTES = 100_000L
    private val lock = Any()
    private val timeFmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    private fun redactTurnCreds(msg: String): String {
        // Замаскировать password/credential из JSON-подобных строк.
        return msg
            .replace(Regex("\"password\"\\s*:\\s*\"[^\"]*\""), "\"password\":\"***\"")
            .replace(Regex("\"credential\"\\s*:\\s*\"[^\"]*\""), "\"credential\":\"***\"")
            .replace(Regex("password=[^,\\s}]+"), "password=***")
            .replace(Regex("credential=[^,\\s}]+"), "credential=***")
    }

    fun write(context: Context, tag: String, msg: String) {
        val safeMsg = redactTurnCreds(msg)
        val line = "${timeFmt.format(Date())} [$tag] $safeMsg\n"
        Log.i(TAG, line.trimEnd())
        synchronized(lock) {
            try {
                val f = file(context)
                if (f.exists() && f.length() > MAX_BYTES) {
                    val bytes = f.readBytes()
                    val tail = bytes.copyOfRange(
                        (bytes.size - TRUNCATE_TO_BYTES.toInt()).coerceAtLeast(0),
                        bytes.size,
                    )
                    f.writeBytes(tail)
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
