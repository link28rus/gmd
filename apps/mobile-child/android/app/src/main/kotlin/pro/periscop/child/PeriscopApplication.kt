package pro.periscop.child

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Process
import android.util.Log

/**
 * v0.60.0 — свой Application ради журнала: [Application.onCreate] выполняется
 * при КАЖДОМ старте процесса, чем бы он ни был поднят (UI, BootReceiver,
 * MY_PACKAGE_REPLACED, FCM, alarm, WorkManager). Больше такого места нет —
 * MainActivity/LocationForegroundService стартуют не всегда.
 *
 * Раньше в манифесте стоял `${applicationName}` = android.app.Application
 * (Flutter подставляет его по умолчанию), так что поведение не меняется.
 */
class PeriscopApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        DiagCrashHandler.install(this)
        if (isMainProcess()) DiagCrashHandler.reportPendingCrash(this)
    }

    private fun isMainProcess(): Boolean {
        val name = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Application.getProcessName()
        } else {
            try {
                (getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
                    .runningAppProcesses?.firstOrNull { it.pid == Process.myPid() }?.processName
            } catch (_: Throwable) {
                null
            }
        }
        return name == null || name == packageName
    }
}

/**
 * Необработанное исключение: стек синхронно в DiagLog (тег `crash`) + флаг в
 * prefs (commit — процесс сейчас умрёт), дальше — предыдущему обработчику.
 * Отправка — при следующем старте процесса ([reportPendingCrash]).
 */
object DiagCrashHandler {
    private const val KEY_PENDING = "crash_pending"
    private const val KEY_AT = "crash_at"

    @Volatile
    private var installed = false

    fun install(ctx: Context) {
        if (installed) return
        installed = true
        val app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            try {
                DiagLog.write(
                    app,
                    "crash",
                    "uncaught in thread '${thread.name}': ${Log.getStackTraceString(e).trimEnd()}",
                )
                DiagConfigStore.prefs(app).edit()
                    .putBoolean(KEY_PENDING, true)
                    .putLong(KEY_AT, System.currentTimeMillis())
                    .commit()
            } catch (_: Throwable) {
                /* журнал не должен мешать штатной обработке падения */
            }
            if (previous != null) {
                previous.uncaughtException(thread, e)
            } else {
                Process.killProcess(Process.myPid())
                System.exit(10)
            }
        }
    }

    fun reportPendingCrash(ctx: Context) {
        try {
            val prefs = DiagConfigStore.prefs(ctx)
            if (!prefs.getBoolean(KEY_PENDING, false)) return
            prefs.edit().putBoolean(KEY_PENDING, false).apply()
            DiagLog.write(ctx, DiagUpload.TAG, "previous process crashed — auto upload")
            DiagUpload.autoTrigger(ctx, DiagUpload.TRIGGER_CRASH)
        } catch (e: Throwable) {
            Log.e("periscop.diag", "reportPendingCrash failed", e)
        }
    }
}
