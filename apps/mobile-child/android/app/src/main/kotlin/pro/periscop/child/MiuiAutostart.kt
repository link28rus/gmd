package pro.periscop.child

import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings

/**
 * v0.81.0 — переключатель «Автозапуск» в MIUI/HyperOS (Безопасность →
 * Приложения → Автозапуск). Когда он выключен, MIUI не доставляет
 * BOOT_COMPLETED и не даёт будильнику heartbeat поднять убитый процесс:
 * трекинг стоит до ручного открытия приложения (журнал Степана, 2026-10:
 * дыры 21 ч, 34 ч и 7,5 суток).
 *
 * Публичного API у MIUI нет. Читаем app-op MIUI `OP_AUTO_START` (10008)
 * двумя способами через reflection, без обхода ограничений hidden API
 * (библиотеки вроде MIUI-autostart тянут HiddenApiBypass — лишний признак
 * «вредоносности» для антивирусов). Не прочиталось — [State.UNKNOWN]:
 * плашку не показываем, чтобы не пугать ложной тревогой.
 */
object MiuiAutostart {
    enum class State { ENABLED, DISABLED, UNKNOWN, NOT_MIUI }

    private const val OP_AUTO_START = 10008

    @Volatile
    private var lastMethod: String = "-"

    fun isMiui(): Boolean {
        if (Build.MANUFACTURER.equals("xiaomi", ignoreCase = true)) return true
        return systemProp("ro.miui.ui.version.code").isNotEmpty() ||
            systemProp("ro.mi.os.version.code").isNotEmpty()
    }

    fun state(ctx: Context): State {
        if (!isMiui()) return State.NOT_MIUI
        viaAppOps(ctx)?.let { return it }
        viaMiuiUtils(ctx)?.let { return it }
        lastMethod = "не прочитано"
        return State.UNKNOWN
    }

    /** Для снимка журнала: состояние + каким способом прочитано. */
    fun describe(ctx: Context): String {
        val s = state(ctx)
        return when (s) {
            State.NOT_MIUI -> "n/a (не MIUI)"
            State.ENABLED -> "включён ($lastMethod)"
            State.DISABLED -> "ВЫКЛЮЧЕН ($lastMethod)"
            State.UNKNOWN -> "неизвестно ($lastMethod)"
        }
    }

    // AppOpsManager.checkOpNoThrow(int, int, String) — скрытый, но в
    // «unsupported»-списке (доступен приложениям). MIUI хранит в нём свои op'ы.
    private fun viaAppOps(ctx: Context): State? = try {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val m = AppOpsManager::class.java.getMethod(
            "checkOpNoThrow",
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            String::class.java,
        )
        val mode = m.invoke(ops, OP_AUTO_START, Process.myUid(), ctx.packageName) as? Int
        lastMethod = "appops=$mode"
        when (mode) {
            AppOpsManager.MODE_ALLOWED -> State.ENABLED
            AppOpsManager.MODE_IGNORED -> State.DISABLED
            // MODE_ERRORED — op не поддержан прошивкой; это не «выключен».
            else -> null
        }
    } catch (e: Throwable) {
        lastMethod = "appops: ${e.javaClass.simpleName}"
        null
    }

    // Внутренний помощник MIUI: 0 — включён, 1 — выключен.
    private fun viaMiuiUtils(ctx: Context): State? = try {
        val cls = Class.forName("android.miui.AppOpsUtils")
        val m = cls.getMethod("getApplicationAutoStart", Context::class.java, String::class.java)
        val r = m.invoke(null, ctx, ctx.packageName) as? Int
        lastMethod = "AppOpsUtils=$r"
        when (r) {
            0 -> State.ENABLED
            1 -> State.DISABLED
            else -> null
        }
    } catch (e: Throwable) {
        lastMethod = "$lastMethod; AppOpsUtils: ${e.javaClass.simpleName}"
        null
    }

    /**
     * Экран «Автозапуск» в «Безопасности» MIUI; если его нет (прошивка
     * переименовала) — карточка приложения, там тоже есть переключатель.
     */
    fun openSettings(ctx: Context): Boolean {
        val direct = Intent()
            .setComponent(
                ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity",
                ),
            )
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(direct)
            DiagLog.write(ctx, "autostart", "openSettings: экран автозапуска MIUI")
            return true
        } catch (e: Throwable) {
            DiagLog.write(ctx, "autostart", "openSettings: ${e.javaClass.simpleName} — карточка приложения")
        }
        return try {
            ctx.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        } catch (e: Throwable) {
            DiagLog.write(ctx, "autostart", "openSettings: карточка приложения FAILED: ${e.message}")
            false
        }
    }

    private fun systemProp(key: String): String = try {
        Class.forName("android.os.SystemProperties")
            .getMethod("get", String::class.java)
            .invoke(null, key) as? String ?: ""
    } catch (_: Throwable) {
        ""
    }
}
