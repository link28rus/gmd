package ru.link28rus.gmd.child

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * v0.38 Phase 6.1: daily worker для отправки списка установленных apps + иконок.
 *
 * Стратегия:
 *  1. collectInstalledApps() через PackageManager (тяжёлая — ~100-500ms из-за
 *     PNG-кодирования иконок 96x96).
 *  2. POST /child/installed-apps с payload без pngBytes — backend вернёт список
 *     missingIconSha256, которых ещё нет в кэше app_icons.
 *  3. Если missing > 0 — батчами по 50 шлём POST /child/app-icons (с pngBytes
 *     base64). Это происходит в основном на ПЕРВОМ запуске; в последующие дни
 *     missing будет почти всегда пустой (новый pkg либо update иконки).
 *
 * 4xx-skip / 5xx-retry, как в UsageStatsReportWorker.
 *
 * Запускается раз в сутки через AppControlScheduler. Изменения apps (install/
 * uninstall в течение дня) НЕ отслеживаются realtime — это OK для статистики
 * родителя; granularity 24ч приемлема.
 */
class InstalledAppsReportWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  override suspend fun doWork(): Result {
    val ctx = applicationContext
    if (NativeCreds.getToken(ctx).isNullOrEmpty()) {
      DiagLog.write(ctx, TAG, "skip — no device-token (claim не прошёл)")
      return Result.success()
    }

    val tz = AppControlNative.deviceTimezone()
    val apps = AppControlNative.collectInstalledApps(ctx)
    DiagLog.write(ctx, TAG, "collected ${apps.size} apps (tz=$tz)")
    if (apps.isEmpty()) {
      // v0.50.6: ушли с QUERY_ALL_PACKAGES на <queries> MAIN/LAUNCHER. Пустой
      // список здесь маловероятен — на любом устройстве есть как минимум
      // launcher / Settings / Phone apps с launcher activity. Возможные
      // причины: 1) OEM с урезанным `<queries>` matching (редко); 2) early-
      // boot до PackageManager scan'а (workmanager обычно запускается позже).
      DiagLog.write(ctx, TAG, "no launchable apps — unexpected, check <queries> manifest block")
      return Result.success()
    }

    val res = AppControlHttp.postInstalledApps(ctx, tz, apps)
    if (!res.ok) {
      return classifyTransient(ctx, res, "installed-apps")
    }
    val missingArr = res.bodyJson?.optJSONArray("missingIconSha256")
    val missingShas = mutableSetOf<String>()
    if (missingArr != null) {
      for (i in 0 until missingArr.length()) {
        missingShas.add(missingArr.optString(i))
      }
    }
    DiagLog.write(ctx, TAG, "backend missing ${missingShas.size} icons")

    if (missingShas.isEmpty()) return Result.success()

    // Берём из apps только те, чей iconSha256 ∈ missingShas, шлём батчами по 50.
    val needUpload = apps.filter { it.iconSha256 in missingShas }
    val chunks = needUpload.chunked(BATCH_SIZE)
    var uploadedTotal = 0
    var skippedTotal = 0
    for ((idx, chunk) in chunks.withIndex()) {
      val r = AppControlHttp.postAppIcons(ctx, chunk)
      if (!r.ok) {
        DiagLog.write(ctx, TAG, "icons batch ${idx + 1}/${chunks.size} failed (status=${r.statusCode})")
        // 4xx-skip / 5xx-retry, но не для всего worker'а — считаем uploaded и
        // пробуем следующий batch. Если все упали — финальный classify.
        continue
      }
      uploadedTotal += r.bodyJson?.optInt("uploaded", 0) ?: 0
      skippedTotal += r.bodyJson?.optInt("skipped", 0) ?: 0
    }
    DiagLog.write(ctx, TAG, "icons done — uploaded=$uploadedTotal, skipped=$skippedTotal across ${chunks.size} batches")
    return Result.success()
  }

  private fun classifyTransient(ctx: Context, res: AppControlHttp.Result, op: String): Result {
    return when {
      res.statusCode == 401 || res.statusCode == 403 -> {
        DiagLog.write(ctx, TAG, "$op auth error ${res.statusCode}, triggering escape probe")
        try {
          ChildEscapeOrchestrator.probe(ctx)
        } catch (e: Throwable) {
          DiagLog.write(ctx, TAG, "$op escape probe failed: ${e.message}")
        }
        Result.success()
      }
      res.statusCode in 400..499 -> {
        DiagLog.write(ctx, TAG, "$op client error ${res.statusCode}, success-skip (bug)")
        Result.success()
      }
      else -> {
        DiagLog.write(ctx, TAG, "$op transient (status=${res.statusCode}), retry")
        Result.retry()
      }
    }
  }

  companion object {
    const val TAG = "installed_apps_worker"
    const val UNIQUE_NAME = "gmd_installed_apps_daily"
    private const val BATCH_SIZE = 50
  }
}
