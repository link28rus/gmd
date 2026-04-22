package ru.link28rus.gmd.child

import android.content.Context
import android.content.SharedPreferences

// Plain-prefs со слепком deviceToken и apiBaseUrl — чтобы нативная
// PinLockActivity и Accessibility flow могли делать HTTP-запрос без
// Flutter engine (который не успеет подняться в момент перехвата
// системного экрана). Token уже хранится в EncryptedSharedPreferences
// через flutter_secure_storage — тут просто зеркало для native-слоя.
object NativeCreds {
    private const val PREFS = "gmd_native"
    private const val KEY_TOKEN = "device_token"
    private const val KEY_API = "api_base_url"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, token: String?, apiBaseUrl: String?) {
        prefs(context).edit()
            .also { editor ->
                if (token != null) editor.putString(KEY_TOKEN, token) else editor.remove(KEY_TOKEN)
                if (apiBaseUrl != null) editor.putString(KEY_API, apiBaseUrl) else editor.remove(KEY_API)
            }
            .apply()
    }

    fun getToken(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)
    fun getApiBaseUrl(context: Context): String? = prefs(context).getString(KEY_API, null)
}
