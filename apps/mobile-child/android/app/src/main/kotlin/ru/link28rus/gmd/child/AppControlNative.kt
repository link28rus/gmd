package ru.link28rus.gmd.child

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Process
import android.provider.Settings
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.TimeZone

/**
 * Phase 6.1 (v0.38) native helpers для screen-time reporting.
 *
 * Источник правды:
 *   - `UsageStatsManager` — событийный поток ACTIVITY_RESUMED/PAUSED, агрегируем
 *     в часовые bucket'ы по local-date в TZ устройства.
 *   - `PackageManager.getInstalledApplications` — снапшот установленных apps,
 *     с иконками 96x96 PNG (sha256-dedupe). Требует QUERY_ALL_PACKAGES (Android 11+).
 *
 * Permission `PACKAGE_USAGE_STATS` — special access. Грантится в Settings →
 * Special access → Usage data. Без него `queryEvents` возвращает пустой курсор
 * (без exception). Helper `hasUsageStatsPermission` проверяет заранее, и UI
 * показывает wizard.
 *
 * Все методы безопасно вызываются с любого потока — никаких UI mutations.
 */
object AppControlNative {

  private const val TAG = "app_control"
  private const val ICON_SIZE_PX = 96
  private const val ICON_MAX_BYTES = 100 * 1024  // 100KB raw PNG, sync с backend

  /**
   * Проверка PACKAGE_USAGE_STATS permission через AppOpsManager.
   * Не использует hasSystemFeature — это special access, проверяется именно по
   * mode operation.
   *
   * Возвращает true если permission granted И device-version поддерживает
   * UsageStatsManager (Android 5.0+).
   */
  fun hasUsageStatsPermission(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP_MR1) return false
    val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        ctx.packageName,
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        ctx.packageName,
      )
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  /**
   * Открывает системный экран Settings → Usage data access.
   * После grant'а пользователь возвращается в наш app — UI должен через
   * pull-to-refresh / lifecycle resume повторить hasUsageStatsPermission.
   */
  fun openUsageStatsSettings(ctx: Context) {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
  }

  /** IANA timezone устройства (например "Europe/Moscow"). Шлётся в backend. */
  fun deviceTimezone(): String = TimeZone.getDefault().id

  // ─── Installed apps + icons ──────────────────────────────────────────────

  data class InstalledAppPayload(
    val packageName: String,
    val appLabel: String,
    val isSystem: Boolean,
    val iconSha256: String,
    val iconPngBytes: ByteArray, // raw PNG, до 100KB
  )

  /**
   * Снапшот всех установленных apps.
   *
   * Включает label, isSystem flag, иконку 96x96 PNG + sha256.
   * Иконки рисуются из `PackageManager.getApplicationIcon` через Canvas
   * (поддержка adaptive icons на Android 8+).
   *
   * Не возвращает наш own package (фильтруется заранее).
   *
   * Возвращает пустой список если нет permission `QUERY_ALL_PACKAGES`
   * (Android 11+ может вернуть только наш package, тогда список будет почти пустой).
   */
  fun collectInstalledApps(ctx: Context): List<InstalledAppPayload> {
    val pm = ctx.packageManager
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      PackageManager.ApplicationInfoFlags.of(0L)
    } else {
      null
    }
    val all: List<ApplicationInfo> =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getInstalledApplications(flags!!)
      } else {
        @Suppress("DEPRECATION")
        pm.getInstalledApplications(0)
      }

    val result = ArrayList<InstalledAppPayload>(all.size)
    for (ai in all) {
      // Skip own package
      if (ai.packageName == ctx.packageName) continue
      try {
        val label = pm.getApplicationLabel(ai).toString()
        val drawable = pm.getApplicationIcon(ai)
        val pngBytes = drawableToPngBytes(drawable)
        if (pngBytes.size > ICON_MAX_BYTES) {
          DiagLog.write(ctx, TAG, "skip ${ai.packageName} — icon ${pngBytes.size}B exceeds limit")
          continue
        }
        val sha = sha256Hex(pngBytes)
        val isSystem = (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0 ||
          (ai.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
        result.add(
          InstalledAppPayload(
            packageName = ai.packageName,
            appLabel = label,
            isSystem = isSystem,
            iconSha256 = sha,
            iconPngBytes = pngBytes,
          )
        )
      } catch (e: Throwable) {
        DiagLog.write(ctx, TAG, "skip ${ai.packageName} — ${e.javaClass.simpleName}: ${e.message}")
      }
    }
    DiagLog.write(ctx, TAG, "collectInstalledApps: ${result.size} apps")
    return result
  }

  private fun drawableToPngBytes(drawable: Drawable): ByteArray {
    val bitmap = Bitmap.createBitmap(ICON_SIZE_PX, ICON_SIZE_PX, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    when {
      drawable is BitmapDrawable -> {
        val src = drawable.bitmap
        val scaled = Bitmap.createScaledBitmap(src, ICON_SIZE_PX, ICON_SIZE_PX, true)
        canvas.drawBitmap(scaled, 0f, 0f, null)
        if (scaled !== src) scaled.recycle()
      }
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && drawable is AdaptiveIconDrawable -> {
        drawable.setBounds(0, 0, ICON_SIZE_PX, ICON_SIZE_PX)
        drawable.draw(canvas)
      }
      else -> {
        drawable.setBounds(0, 0, ICON_SIZE_PX, ICON_SIZE_PX)
        drawable.draw(canvas)
      }
    }
    val out = ByteArrayOutputStream()
    // PNG quality игнорируется (lossless), но передаём 100 для consistency.
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    bitmap.recycle()
    return out.toByteArray()
  }

  private fun sha256Hex(bytes: ByteArray): String {
    val md = MessageDigest.getInstance("SHA-256")
    val digest = md.digest(bytes)
    val sb = StringBuilder(digest.size * 2)
    for (b in digest) {
      val v = b.toInt() and 0xff
      sb.append(HEX[v ushr 4])
      sb.append(HEX[v and 0xf])
    }
    return sb.toString()
  }

  private val HEX = charArrayOf(
    '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
  )

  // ─── Usage buckets ───────────────────────────────────────────────────────

  data class UsageBucketPayload(
    val date: String, // YYYY-MM-DD в local-TZ
    val hour: Int,    // 0..23 в local-TZ
    val packageName: String,
    val seconds: Int,
  )

  private val DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd")

  /**
   * Собирает часовые usage bucket'ы за последние `daysBack` дней (включая сегодня).
   *
   * daysBack=1 → только сегодня (для 15-min worker'а).
   * daysBack=7 → последние 7 дней (для backfill при первом запуске).
   *
   * Метод парсит UsageEvents (ACTIVITY_RESUMED → openMap, ACTIVITY_PAUSED → close),
   * раскладывает foreground-time по bucket'ам hours-in-tz. Если RESUMED был до начала
   * запрашиваемого окна — стартуем bucket с queryStart.
   *
   * Возвращает пустой список если нет permission (UsageStatsManager.queryEvents
   * молча вернёт пустой курсор).
   */
  fun collectUsageBuckets(ctx: Context, daysBack: Int): List<UsageBucketPayload> {
    require(daysBack in 1..30) { "daysBack must be 1..30, got $daysBack" }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP_MR1) return emptyList()
    if (!hasUsageStatsPermission(ctx)) return emptyList()

    val zone = ZoneId.systemDefault()
    val now = Instant.now()
    val today = LocalDate.now(zone)
    val startDate = today.minusDays((daysBack - 1).toLong())
    val queryStart = startDate.atStartOfDay(zone).toInstant().toEpochMilli()
    val queryEnd = now.toEpochMilli()

    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(queryStart, queryEnd)
    val ev = UsageEvents.Event()

    // Map (hour-bucket-key, packageName) → seconds, key = "yyyy-MM-dd|HH"
    val buckets = HashMap<Triple<String, Int, String>, Long>()
    val openMap = HashMap<String, Long>() // pkg → epochMilli of last RESUMED

    while (events.hasNextEvent()) {
      events.getNextEvent(ev)
      val pkg = ev.packageName ?: continue
      // Skip our own package — иначе UI работа парента считается как time-in-app
      if (pkg == ctx.packageName) {
        openMap.remove(pkg)
        continue
      }
      when (ev.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          openMap[pkg] = ev.timeStamp
        }
        UsageEvents.Event.ACTIVITY_PAUSED,
        UsageEvents.Event.ACTIVITY_STOPPED -> {
          val openedAt = openMap.remove(pkg) ?: continue
          accumulate(buckets, pkg, openedAt, ev.timeStamp, zone, queryStart)
        }
      }
    }
    // Не закрытые сессии (app сейчас в foreground): закрываем по queryEnd
    for ((pkg, openedAt) in openMap) {
      accumulate(buckets, pkg, openedAt, queryEnd, zone, queryStart)
    }

    val out = ArrayList<UsageBucketPayload>(buckets.size)
    for ((key, ms) in buckets) {
      out.add(
        UsageBucketPayload(
          date = key.first,
          hour = key.second,
          packageName = key.third,
          // Округляем вниз — не overcount. Min 1сек чтобы запись имела смысл.
          seconds = (ms / 1000L).toInt().coerceAtLeast(0),
        )
      )
    }
    DiagLog.write(ctx, TAG, "collectUsageBuckets days=$daysBack → ${out.size} buckets")
    return out
  }

  /**
   * Распределяет интервал [openedAt..closedAt] по часовым bucket'ам в локальном TZ.
   * Корректно режет интервалы, пересекающие границу часов и дней.
   */
  private fun accumulate(
    buckets: HashMap<Triple<String, Int, String>, Long>,
    pkg: String,
    openedAt: Long,
    closedAt: Long,
    zone: ZoneId,
    queryStart: Long,
  ) {
    var cursor = maxOf(openedAt, queryStart)
    if (cursor >= closedAt) return
    val end = closedAt
    while (cursor < end) {
      val ldt = Instant.ofEpochMilli(cursor).atZone(zone)
      val date = ldt.toLocalDate().format(DATE_FMT)
      val hour = ldt.hour
      // Граница следующего часа в epoch ms
      val nextHourStart = ldt.withMinute(0).withSecond(0).withNano(0)
        .plusHours(1).toInstant().toEpochMilli()
      val sliceEnd = minOf(nextHourStart, end)
      val ms = sliceEnd - cursor
      if (ms > 0) {
        val key = Triple(date, hour, pkg)
        buckets[key] = (buckets[key] ?: 0L) + ms
      }
      cursor = sliceEnd
    }
  }
}
