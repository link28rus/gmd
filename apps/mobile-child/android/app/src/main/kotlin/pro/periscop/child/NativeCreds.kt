package pro.periscop.child

import android.content.Context
import android.content.SharedPreferences

// Plain-prefs со слепком deviceToken и apiBaseUrl — чтобы нативная
// PinLockActivity и Accessibility flow могли делать HTTP-запрос без
// Flutter engine (который не успеет подняться в момент перехвата
// системного экрана). Token уже хранится в EncryptedSharedPreferences
// через flutter_secure_storage — тут просто зеркало для native-слоя.
object NativeCreds {
    private const val PREFS = "periscop_native"
    private const val KEY_TOKEN = "device_token"
    private const val KEY_API = "api_base_url"
    private const val KEY_PROTECTION_ENABLED = "protection_enabled"
    private const val KEY_UNLINKED = "device_unlinked"
    private const val KEY_BINDING_STARTED_AT = "binding_started_at"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun save(context: Context, token: String?, apiBaseUrl: String?) {
        val changed = getToken(context) != token
        if (changed) BlockManager.clearAll(context)
        prefs(context).edit()
            .also { editor ->
                if (token != null) editor.putString(KEY_TOKEN, token) else editor.remove(KEY_TOKEN)
                if(changed || !prefs(context).contains(KEY_BINDING_STARTED_AT)) editor.putLong(KEY_BINDING_STARTED_AT,System.currentTimeMillis())
                // Новый токен = устройство снова привязано.
                if (token != null) editor.remove(KEY_UNLINKED)
                if (apiBaseUrl != null) editor.putString(KEY_API, apiBaseUrl) else editor.remove(KEY_API)
            }
            .apply()
    }

    @Synchronized
    fun withCurrent(context: Context, token: String, action: () -> Unit): Boolean {
        if (getToken(context) != token || isUnlinked(context)) return false
        action()
        return true
    }

    fun getToken(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    @Synchronized
    fun bindingStartedAt(context: Context): Long {
        val p=prefs(context)
        if(!p.contains(KEY_BINDING_STARTED_AT) || p.getLong(KEY_BINDING_STARTED_AT,0L) > System.currentTimeMillis())
            p.edit().putLong(KEY_BINDING_STARTED_AT,System.currentTimeMillis()).commit()
        return p.getLong(KEY_BINDING_STARTED_AT,System.currentTimeMillis())
    }

    @Synchronized
    fun restartUsageClock(context: Context) {
        if(getToken(context).isNullOrEmpty() || isUnlinked(context)) return
        val now=System.currentTimeMillis()
        prefs(context).edit().putLong(KEY_BINDING_STARTED_AT,now).commit()
        UsagePeriods.restartClock(context,now)
    }

    // Сервер отозвал device-token (родитель удалил ребёнка или сбросил
    // устройство). Флаг явный, а не «токена нет»: зеркало токена пишется только
    // при открытии главного экрана, и на телефоне, где его давно не открывали,
    // пустой токен не значит «отвязан». Снимается [save] с новым токеном и
    // явным запуском сервиса из UI. commit — следом может прийти stopSelf.
    @Synchronized
    fun markUnlinked(context: Context) {
        BlockManager.clearAll(context)
        prefs(context).edit()
            .remove(KEY_TOKEN)
            .putBoolean(KEY_UNLINKED, true)
            .commit()
    }

    fun clearUnlinked(context: Context) {
        prefs(context).edit().remove(KEY_UNLINKED).apply()
    }

    fun isUnlinked(context: Context): Boolean = prefs(context).getBoolean(KEY_UNLINKED, false)
    fun getApiBaseUrl(context: Context): String? = prefs(context).getString(KEY_API, null)

    // Кеш protection-флага для AccessibilityService: обновляется каждый раз
    // когда UI получает ответ GET /child/protection. При enabled=false сервис
    // делает early-return и не перехватывает экраны — родитель отключил защиту
    // в кабинете. Default (никогда не читали бэкенд) = true, чтобы не
    // деактивироваться на старте до первого heartbeat.
    fun setProtectionEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_PROTECTION_ENABLED, enabled).apply()
    }

    fun isProtectionEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_PROTECTION_ENABLED, true)
}
