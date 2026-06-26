package pro.periscop.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * v0.38 ESCAPE HATCH: periodic probe для проверки актуальности device-token.
 *
 * Запускается раз в 1 час (минимум WorkManager periodic = 15 мин, но 1ч
 * достаточно — родитель удаляет ребёнка не каждую минуту, а 1ч даёт хороший
 * trade-off latency vs батарея).
 *
 * Дополнительно дёргается из workers (UsageStats / InstalledApps) сразу после
 * получения 401 — для быстрой реакции, чтобы не ждать следующего часа.
 *
 * Никогда не возвращает Result.retry() — потому что probe идёт периодически,
 * нет смысла спамить retry в случае ошибки сети (всё равно через час повторим).
 */
class EscapeProbeWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  override suspend fun doWork(): Result {
    val ctx = applicationContext
    if (NativeCreds.getToken(ctx).isNullOrEmpty()) {
      // Нет creds — либо не клеймили, либо уже escape сделали.
      DiagLog.write(ctx, TAG, "skip — no device-token")
      return Result.success()
    }
    val res = ChildEscapeOrchestrator.probe(ctx)
    DiagLog.write(ctx, TAG, "probe result=$res")
    return Result.success()
  }

  companion object {
    const val TAG = "escape_probe_worker"
    const val UNIQUE_NAME = "gmd_escape_probe_periodic"
  }
}
