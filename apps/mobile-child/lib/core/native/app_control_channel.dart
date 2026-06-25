import 'package:flutter/services.dart';

/// v0.38 Phase 6.1: bridge к native AppControlNative.kt.
///
/// Только UI-isolate. Workers (WorkManager periodic, ещё не реализованы в этом
/// rc) дёргают AppControlNative напрямую из Kotlin — channel'ом не пользуются.
///
/// Все методы могут throw PlatformException — caller обязан обработать
/// (обычно — DiagLog + skip/retry).
class AppControlChannel {
  static const MethodChannel _ch =
      MethodChannel('ru.link28rus.gmd.child/app_control');

  /// Granted ли PACKAGE_USAGE_STATS permission. На iOS / web — false.
  static Future<bool> hasUsageStatsPermission() async {
    final granted = await _ch.invokeMethod<bool>('hasUsageStatsPermission');
    return granted ?? false;
  }

  /// Открыть системные Settings → Special access → Usage data.
  /// Пользователь грантит permission руками, после возврата в app
  /// нужно повторно вызвать hasUsageStatsPermission().
  static Future<void> openUsageStatsSettings() async {
    await _ch.invokeMethod<void>('openUsageStatsSettings');
  }

  /// v0.39 Phase 6.2: включён ли наш GmdAccessibilityService.
  /// На iOS / web — false.
  static Future<bool> isAccessibilityServiceEnabled() async {
    final granted = await _ch.invokeMethod<bool>('isAccessibilityServiceEnabled');
    return granted ?? false;
  }

  /// v0.39 Phase 6.2: открыть Settings → Accessibility (общий список).
  /// Пользователь сам находит «gmd_child» и включает.
  static Future<void> openAccessibilitySettings() async {
    await _ch.invokeMethod<void>('openAccessibilitySettings');
  }

  /// v0.39 Phase 6.2: открыть карточку приложения в Settings.
  /// Используется для разрешения «Ограниченных настроек» на MIUI/HyperOS
  /// (⋮ → «Разрешить ограниченные настройки») перед грантом Accessibility.
  static Future<void> openAppDetailsSettings() async {
    await _ch.invokeMethod<void>('openAppDetailsSettings');
  }

  /// v0.39.5 Phase 6.2 fix: дано ли SYSTEM_ALERT_WINDOW (Settings.canDrawOverlays).
  /// Без него `WindowManager.addView` с TYPE_APPLICATION_OVERLAY бросает
  /// BadTokenException — visual blocking overlay не показывается, остаётся
  /// только GLOBAL_ACTION_HOME fallback в a11y.
  static Future<bool> canDrawOverlays() async {
    final granted = await _ch.invokeMethod<bool>('canDrawOverlays');
    return granted ?? false;
  }

  /// v0.39.5: открыть Settings → Спецдоступ → Поверх других приложений.
  /// Передаём `package:<our>` — на большинстве OEM открывает уже на нашем app.
  static Future<void> openOverlaySettings() async {
    await _ch.invokeMethod<void>('openOverlaySettings');
  }

  /// Задача #61: one-shot consume флага «первый запуск после обновления APK».
  /// Native [PostUpdateGuard] детектит смену versionCode в `MainActivity.onCreate`
  /// и выставляет flag pending=true. Этот метод возвращает [PostUpdateInfo]
  /// с from/to versionName ОДИН РАЗ, потом флаг очищается. Если обновления
  /// не было (или флаг уже consume'нут) → null.
  ///
  /// На HyperOS/MIUI после sideload-обновления слетают AccessibilityService и
  /// Device Admin (известный bug OS). Caller использует этот флаг как trigger
  /// для активного rescue-flow вместо пассивного баннера.
  static Future<PostUpdateInfo?> consumePostUpdateFlag() async {
    final raw =
        await _ch.invokeMethod<Map<dynamic, dynamic>>('consumePostUpdateFlag');
    if (raw == null) return null;
    return PostUpdateInfo(
      fromVersionName: raw['fromVersionName'] as String? ?? '',
      toVersionName: raw['toVersionName'] as String? ?? '',
    );
  }

  /// IANA timezone устройства (например "Europe/Moscow").
  /// Шлётся в payload installed-apps / usage-reports.
  static Future<String> deviceTimezone() async {
    final tz = await _ch.invokeMethod<String>('deviceTimezone');
    return tz ?? 'UTC';
  }

  /// Снапшот launchable apps с иконками.
  ///
  /// Тяжёлая операция (~100-500ms на устройстве: PNG-кодирование 100-500 иконок).
  /// Запускается на native background-thread, future resolve когда готово.
  ///
  /// Не включает наш own package (отфильтрован в native).
  ///
  /// v0.50.6: использует `<queries>` MAIN/LAUNCHER вместо QUERY_ALL_PACKAGES
  /// (RuStore-friendly, см. AndroidManifest.xml). Возвращает только apps
  /// с launcher activity — системные служебные apps без launcher'а не входят.
  static Future<List<InstalledAppNative>> collectInstalledApps() async {
    final raw = await _ch.invokeMethod<List<dynamic>>('collectInstalledApps');
    if (raw == null) return const [];
    return raw
        .cast<Map<dynamic, dynamic>>()
        .map(InstalledAppNative.fromMap)
        .toList();
  }

  /// Поднять periodic workers (UsageStats 15-min + InstalledApps 24h).
  /// Идемпотентно (KEEP-policy). Вызывается обычно после успешного claim'а.
  /// Также native код сам вызывает это в MainActivity.onCreate если есть token.
  static Future<void> scheduleAll() async {
    await _ch.invokeMethod<void>('scheduleAll');
  }

  /// Триггер немедленного запуска UsageStats worker'а
  /// (для wizard'а — после grant'а сразу залить данные на бэк).
  static Future<void> runUsageNow() async {
    await _ch.invokeMethod<void>('runUsageNow');
  }

  /// Триггер немедленного запуска InstalledApps worker'а
  /// (для wizard'а — сразу отправить snapshot apps + иконки).
  static Future<void> runInstalledAppsNow() async {
    await _ch.invokeMethod<void>('runInstalledAppsNow');
  }

  /// Часовые usage-bucket'ы за последние [daysBack] дней (включая сегодня).
  ///
  /// daysBack=1 → только сегодня (для 15-min worker'а).
  /// daysBack=7 → ретроспектива при первом запуске (UsageStatsManager хранит
  ///                до ~7 дней событий для подавляющего большинства устройств).
  ///
  /// Возвращает пустой список если нет PACKAGE_USAGE_STATS permission
  /// (queryEvents молча возвращает пустой курсор).
  static Future<List<UsageBucketNative>> collectUsageBuckets({
    required int daysBack,
  }) async {
    assert(daysBack >= 1 && daysBack <= 30);
    final raw = await _ch.invokeMethod<List<dynamic>>(
      'collectUsageBuckets',
      <String, dynamic>{'daysBack': daysBack},
    );
    if (raw == null) return const [];
    return raw
        .cast<Map<dynamic, dynamic>>()
        .map(UsageBucketNative.fromMap)
        .toList();
  }
}

/// Задача #61: payload one-shot pending-флага после обновления APK.
class PostUpdateInfo {
  const PostUpdateInfo({
    required this.fromVersionName,
    required this.toVersionName,
  });

  final String fromVersionName;
  final String toVersionName;

  @override
  String toString() => 'PostUpdateInfo($fromVersionName → $toVersionName)';
}

/// Один установленный app с иконкой. Иконка — raw PNG bytes (96x96 RGBA).
class InstalledAppNative {
  InstalledAppNative({
    required this.packageName,
    required this.appLabel,
    required this.isSystem,
    required this.iconSha256,
    required this.iconPngBytes,
  });

  factory InstalledAppNative.fromMap(Map<dynamic, dynamic> m) {
    final bytes = m['iconPngBytes'];
    final pngBytes = bytes is Uint8List
        ? bytes
        : Uint8List.fromList((bytes as List).cast<int>());
    return InstalledAppNative(
      packageName: m['packageName'] as String,
      appLabel: m['appLabel'] as String,
      isSystem: m['isSystem'] as bool? ?? false,
      iconSha256: m['iconSha256'] as String,
      iconPngBytes: pngBytes,
    );
  }

  final String packageName;
  final String appLabel;
  final bool isSystem;
  final String iconSha256;
  final Uint8List iconPngBytes;
}

/// Один часовой bucket usage.
class UsageBucketNative {
  UsageBucketNative({
    required this.date,
    required this.hour,
    required this.packageName,
    required this.seconds,
  });

  factory UsageBucketNative.fromMap(Map<dynamic, dynamic> m) =>
      UsageBucketNative(
        date: m['date'] as String,
        hour: m['hour'] as int,
        packageName: m['packageName'] as String,
        seconds: m['seconds'] as int,
      );

  final String date; // YYYY-MM-DD в local-TZ
  final int hour; // 0..23
  final String packageName;
  final int seconds;

  Map<String, dynamic> toJson() => {
        'date': date,
        'hour': hour,
        'packageName': packageName,
        'seconds': seconds,
      };
}
