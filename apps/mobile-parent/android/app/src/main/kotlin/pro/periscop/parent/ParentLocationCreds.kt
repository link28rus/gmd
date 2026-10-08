package pro.periscop.parent

import android.content.Context
import android.content.SharedPreferences

/**
 * v0.70.0 — креды фоновой геолокации родителя для [ParentLocationService].
 *
 * Отдельные SharedPreferences (не FlutterSharedPreferences): пишет их Dart через
 * MethodChannel `pro.periscop.parent/location` (`saveCreds` / `clearCreds` /
 * `start` / `stop`), читают служба, сторож и ресивер автозапуска — без
 * Flutter-движка. Токен — долгоживущий `X-Parent-Location-Token`, не JWT:
 * refresh-токен родителя ротируется, повтор старого отзывает все сессии.
 */
object ParentLocationCreds {
    private const val PREFS = "periscop_parent_location"
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_TOKEN = "token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_AUTH_FAILED = "auth_failed"
    private const val KEY_LAST_UPLOAD_MS = "last_upload_ms"
    private const val KEY_LAST_ERROR = "last_error"

    data class Creds(
        val baseUrl: String?,
        val token: String?,
        val deviceId: String?,
        val enabled: Boolean,
    ) {
        val usable: Boolean
            get() = enabled && !token.isNullOrBlank() && !baseUrl.isNullOrBlank()
    }

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun read(ctx: Context): Creds {
        val p = prefs(ctx)
        return Creds(
            baseUrl = p.getString(KEY_BASE_URL, null),
            token = p.getString(KEY_TOKEN, null),
            deviceId = p.getString(KEY_DEVICE_ID, null),
            enabled = p.getBoolean(KEY_ENABLED, false),
        )
    }

    // commit(), а не apply(): процесс могут убить сразу после записи (выход
    // из аккаунта, обновление), а сторож и автозапуск смотрят только сюда.
    fun save(ctx: Context, baseUrl: String, token: String, deviceId: String, enabled: Boolean) {
        prefs(ctx).edit()
            .putString(KEY_BASE_URL, baseUrl.trimEnd('/'))
            .putString(KEY_TOKEN, token)
            .putString(KEY_DEVICE_ID, deviceId)
            .putBoolean(KEY_ENABLED, enabled)
            .putBoolean(KEY_AUTH_FAILED, false)
            .commit()
    }

    fun setEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, enabled).commit()
    }

    /** 401 на отправку: токен отозван/неизвестен — стираем, Dart получит новый. */
    fun markAuthFailed(ctx: Context) {
        prefs(ctx).edit()
            .remove(KEY_TOKEN)
            .putBoolean(KEY_AUTH_FAILED, true)
            .commit()
    }

    fun authFailed(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_AUTH_FAILED, false)

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().commit()
    }

    fun recordUpload(ctx: Context, error: String?) {
        val e = prefs(ctx).edit()
        if (error == null) {
            e.putLong(KEY_LAST_UPLOAD_MS, System.currentTimeMillis()).remove(KEY_LAST_ERROR)
        } else {
            e.putString(KEY_LAST_ERROR, error)
        }
        e.apply()
    }

    fun lastUploadMs(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_UPLOAD_MS, 0L)

    fun lastError(ctx: Context): String? = prefs(ctx).getString(KEY_LAST_ERROR, null)
}
