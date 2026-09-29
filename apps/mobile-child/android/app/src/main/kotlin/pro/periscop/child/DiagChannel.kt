package pro.periscop.child

import android.content.Context
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * `pro.periscop.child/diag` — один обработчик для всех Flutter-движков:
 * UI (MainActivity), headless-изолят геолокации (LocationForegroundService)
 * и изолят «Звука вокруг» (SoundAroundService).
 *
 * Методы: write {tag,msg}, debug {tag,msg}, read, clear,
 * upload {reason, trigger?, commandId?} → bool, configSummary → String.
 */
object DiagChannel {
    const val NAME = "pro.periscop.child/diag"

    fun register(context: Context, messenger: BinaryMessenger, defaultTag: String) {
        val app = context.applicationContext
        MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "write" -> {
                        DiagLog.write(app, call.argument<String>("tag") ?: defaultTag, call.argument<String>("msg") ?: "")
                        result.success(null)
                    }
                    "debug" -> {
                        DiagLog.debug(app, call.argument<String>("tag") ?: defaultTag, call.argument<String>("msg") ?: "")
                        result.success(null)
                    }
                    "read" -> result.success(DiagLog.readAll(app))
                    "clear" -> {
                        DiagLog.clear(app)
                        result.success(null)
                    }
                    "upload" -> {
                        val reason = call.argument<String>("reason") ?: DiagUpload.REASON_MANUAL
                        val ok = if (reason == DiagUpload.REASON_AUTO) {
                            DiagUpload.autoTrigger(app, call.argument<String>("trigger") ?: "unknown")
                        } else {
                            DiagUpload.requestManual(app, call.argument<String>("commandId"), "dart:$defaultTag")
                        }
                        result.success(ok)
                    }
                    "configSummary" -> result.success(
                        DiagConfigStore.get(app).summary(System.currentTimeMillis()),
                    )
                    else -> result.notImplemented()
                }
            } catch (e: Throwable) {
                result.error("diag_failed", "${e.javaClass.simpleName}: ${e.message}", null)
            }
        }
    }
}
