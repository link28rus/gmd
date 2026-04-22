package ru.link28rus.gmd.child

import android.app.Activity
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

// Нативная Activity ввода PIN — запускается из GmdAccessibilityService
// при детекте «опасного» экрана. Делает HTTP-запрос на
// POST /child/protection/verify-pin. При успехе: ставит grace-period
// 30 сек в SharedPreferences и finish() — ребёнок может повторить
// Uninstall и сервис его пропустит. При ошибке — показывает текст и
// оставляет экран для повторной попытки.
class PinLockActivity : Activity() {

    private val scope = CoroutineScope(Dispatchers.Main + Job())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Показываем поверх lockscreen и других экранов — Accessibility
        // запускает нас в момент когда ребёнок активно делает action.
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
        )
        setContentView(R.layout.activity_pin_lock)

        val input = findViewById<EditText>(R.id.pin_input)
        val confirm = findViewById<Button>(R.id.pin_confirm)
        val cancel = findViewById<Button>(R.id.pin_cancel)
        val error = findViewById<TextView>(R.id.pin_error)

        cancel.setOnClickListener { finish() }
        confirm.setOnClickListener {
            val pin = input.text.toString().trim()
            if (!pin.matches(Regex("^\\d{4,8}$"))) {
                showError(error, getString(R.string.gmd_pin_lock_invalid))
                return@setOnClickListener
            }
            confirm.isEnabled = false
            error.visibility = TextView.INVISIBLE
            scope.launch {
                val result = withContext(Dispatchers.IO) { verifyPin(pin) }
                confirm.isEnabled = true
                when (result) {
                    VerifyResult.OK -> {
                        GmdAccessibilityService.setGracePeriod(this@PinLockActivity)
                        DiagLog.write(this@PinLockActivity, "pinlock", "verify OK, grace set")
                        finish()
                    }
                    VerifyResult.INVALID -> showError(error, getString(R.string.gmd_pin_lock_invalid))
                    VerifyResult.LOCKED -> showError(error, getString(R.string.gmd_pin_lock_locked))
                    VerifyResult.NO_PARENT_PIN ->
                        showError(error, getString(R.string.gmd_pin_lock_no_parent))
                    VerifyResult.NETWORK ->
                        showError(error, getString(R.string.gmd_pin_lock_network))
                }
            }
        }
    }

    private fun showError(view: TextView, msg: String) {
        view.text = msg
        view.visibility = TextView.VISIBLE
    }

    override fun onDestroy() {
        scope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    private enum class VerifyResult { OK, INVALID, LOCKED, NO_PARENT_PIN, NETWORK }

    private fun verifyPin(pin: String): VerifyResult {
        val token = NativeCreds.getToken(this) ?: return VerifyResult.NETWORK
        val baseUrl = NativeCreds.getApiBaseUrl(this) ?: return VerifyResult.NETWORK
        val url = URL("${baseUrl.trimEnd('/')}/child/protection/verify-pin")
        val conn = url.openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 7000
            conn.readTimeout = 7000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-Child-Token", token)
            val body = JSONObject(mapOf("pin" to pin)).toString()
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
            val code = conn.responseCode
            when (code) {
                200 -> VerifyResult.OK
                401 -> {
                    val errBody = readErrorBody(conn)
                    if (errBody.contains("no_parent_pin")) VerifyResult.NO_PARENT_PIN
                    else VerifyResult.INVALID
                }
                429 -> VerifyResult.LOCKED
                else -> VerifyResult.INVALID
            }
        } catch (t: Throwable) {
            DiagLog.write(this, "pinlock", "verify error: ${t.message}")
            VerifyResult.NETWORK
        } finally {
            conn.disconnect()
        }
    }

    private fun readErrorBody(conn: HttpURLConnection): String {
        return try {
            BufferedReader(InputStreamReader(conn.errorStream ?: return "", Charsets.UTF_8))
                .use { it.readText() }
        } catch (_: Throwable) {
            ""
        }
    }
}
