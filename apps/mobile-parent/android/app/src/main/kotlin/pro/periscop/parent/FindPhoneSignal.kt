package pro.periscop.parent

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * v0.73.0 — «Найти телефон»: общий обработчик сигнала из личного кабинета.
 *
 * Сигнал приходит двумя путями:
 *  - FCM data `{type: PLAY_SIGNAL, signalId}` ([ParentFirebaseMessagingService]);
 *  - запасной: ответ `POST /parent-location/points` содержит `signal.id`, пока
 *    сигнал жив на сервере (≤ 5 мин, без ack) — [ParentLocationUploader].
 *
 * [handle] отсекает повтор по последнему обработанному signalId (оба пути
 * могут принести один и тот же), запускает [SignalSoundService]; служба сама
 * вызывает [ackAsync], когда звук реально пошёл.
 *
 * Здесь же кэш FCM-токена для uploader'а (`device.pushToken`): сервер шлёт
 * PLAY_SIGNAL на токен, который пришёл вместе с точками.
 */
object FindPhoneSignal {
    private const val TAG = "signal"
    private const val PREFS = "periscop_parent_find_phone"
    private const val KEY_LAST_SIGNAL_ID = "last_signal_id"
    private const val KEY_FCM_TOKEN = "fcm_token"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 20_000
    private val lock = Any()

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * Запустить сигнал [signalId], если он ещё не обработан. [source] — для
     * DiagLog («fcm» / «upload»). Можно звать с любого потока.
     */
    fun handle(ctx: Context, signalId: String, source: String) {
        val app = ctx.applicationContext
        val short = signalId.take(8)
        synchronized(lock) {
            if (prefs(app).getString(KEY_LAST_SIGNAL_ID, null) == signalId) {
                DiagLog.write(app, TAG, "signal $short… via $source: уже обработан — пропуск")
                return
            }
            DiagLog.write(app, TAG, "signal $short… via $source: запуск звука")
            if (!startService(app, signalId, source)) return
            // commit(): процесс могут убить сразу после старта — повтор того же
            // сигнала из следующего ответа на точки не должен звонить снова.
            prefs(app).edit().putString(KEY_LAST_SIGNAL_ID, signalId).commit()
        }
    }

    /**
     * startForegroundService; если система не пустила (Android 12+, старт FGS
     * из фона без исключения) — обычный startService: из ответа на точки мы
     * внутри живой службы геолокации, процесс фоновым не считается, и
     * [SignalSoundService] сыграет без foreground-статуса.
     */
    private fun startService(ctx: Context, signalId: String, source: String): Boolean {
        val intent = Intent(ctx, SignalSoundService::class.java)
            .setAction(SignalSoundService.ACTION_PLAY)
            .putExtra(SignalSoundService.EXTRA_SIGNAL_ID, signalId)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(ctx, intent)
            } else {
                ctx.startService(intent)
            }
            DiagLog.write(ctx, TAG, "startForegroundService OK (via $source)")
            return true
        } catch (e: Throwable) {
            // ForegroundServiceStartNotAllowedException / SecurityException.
            DiagLog.write(
                ctx,
                TAG,
                "startForegroundService FAILED (via $source): ${e.javaClass.simpleName}: ${e.message} — retry startService",
            )
        }
        return try {
            ctx.startService(intent)
            DiagLog.write(ctx, TAG, "fallback startService OK (via $source)")
            true
        } catch (e: Throwable) {
            DiagLog.write(
                ctx,
                TAG,
                "startService FAILED (via $source): ${e.javaClass.simpleName}: ${e.message}",
            )
            false
        }
    }

    /** `POST /parent-location/signal/ack {signalId}` в фоновом потоке. */
    fun ackAsync(ctx: Context, signalId: String) {
        val app = ctx.applicationContext
        Thread {
            val short = signalId.take(8)
            try {
                val creds = ParentLocationCreds.read(app)
                if (creds.baseUrl.isNullOrBlank() || creds.token.isNullOrBlank()) {
                    DiagLog.write(app, TAG, "ack $short…: нет кредов — пропуск")
                    return@Thread
                }
                val code = postAck(creds.baseUrl, creds.token, signalId)
                DiagLog.write(app, TAG, "ack $short… → HTTP $code")
            } catch (e: Throwable) {
                DiagLog.write(app, TAG, "ack $short… failed: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    private fun postAck(baseUrl: String, token: String, signalId: String): Int {
        val conn = URL("$baseUrl/parent-location/signal/ack").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("X-Parent-Location-Token", token)
            conn.setRequestProperty("X-Client", "mobile-parent")
            val json = JSONObject().put("signalId", signalId).toString()
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            stream?.close()
            return code
        } finally {
            conn.disconnect()
        }
    }

    /** Закэшированный FCM-токен; null — ещё не узнали. */
    fun cachedFcmToken(ctx: Context): String? =
        prefs(ctx).getString(KEY_FCM_TOKEN, null)?.takeIf { it.isNotBlank() }

    fun saveFcmToken(ctx: Context, token: String) {
        prefs(ctx).edit().putString(KEY_FCM_TOKEN, token).commit()
    }

    /**
     * Асинхронно запросить текущий FCM-токен и положить в кэш. Результат
     * пригодится следующей отправке точек. Без Google-сервисов просто
     * логируем ошибку — уйдёт только имя устройства, сигнал дойдёт запасным путём.
     */
    fun refreshFcmToken(ctx: Context) {
        val app = ctx.applicationContext
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val t = task.result
                    if (!t.isNullOrBlank()) saveFcmToken(app, t)
                } else {
                    DiagLog.write(app, TAG, "FCM token failed: ${task.exception?.javaClass?.simpleName}: ${task.exception?.message}")
                }
            }
        } catch (e: Throwable) {
            // FirebaseApp не инициализирован и т.п.
            DiagLog.write(app, TAG, "FCM token unavailable: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /** «Xiaomi 23078PND5G», без повтора, если модель уже начинается с производителя. */
    fun deviceName(): String {
        val manufacturer = (Build.MANUFACTURER ?: "").trim()
        val model = (Build.MODEL ?: "").trim()
        val maker = manufacturer.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        val name = when {
            model.isEmpty() -> maker
            maker.isEmpty() || model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$maker $model"
        }
        return name.ifEmpty { "Android" }.take(100)
    }
}
