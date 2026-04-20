package ru.link28rus.gmd.child

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

class GmdDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return "Если ты выключишь защиту, мама/папа не смогут тебя найти в случае опасности."
    }
}
