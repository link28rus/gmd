package ru.link28rus.gmd.child

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import java.lang.CharSequence

// L1-защита от удаления приложения: пока DeviceAdmin активен, Android заменяет
// кнопку «Удалить» в Settings → Apps → gmd_child на «Deactivate device
// administrator». Пользователь может попробовать деактивировать — Android
// покажет onDisableRequested-warning ниже. PIN-интеграция (L2 через
// AccessibilityService overlay) добавляется отдельной итерацией.
class ChildDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        DiagLog.write(context, "admin", "DeviceAdmin enabled")
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        DiagLog.write(context, "admin", "DeviceAdmin disable requested")
        return "Это отключит родительский контроль. Обратитесь к родителю — он должен подтвердить это действие из своего кабинета."
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        DiagLog.write(context, "admin", "DeviceAdmin disabled")
    }

    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context, ChildDeviceAdminReceiver::class.java)
    }
}
