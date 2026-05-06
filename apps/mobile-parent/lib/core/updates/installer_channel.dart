import 'package:flutter/services.dart';

/// Auto-update mobile-parent — bridge к InstallerNative.kt.
///
/// Только UI-isolate. Все методы могут throw PlatformException — caller
/// обязан обработать.
class InstallerChannel {
  static const MethodChannel _ch =
      MethodChannel('ru.link28rus.gmd.parent/installer');

  /// Может ли наш app запустить системный installer?
  /// На Android < 8 — всегда true.
  /// На Android 8+ — проверяет PackageManager.canRequestPackageInstalls.
  static Future<bool> canRequestInstall() async {
    final granted = await _ch.invokeMethod<bool>('canRequestInstall');
    return granted ?? false;
  }

  /// Открыть Settings → Установка из неизвестных источников → наш app.
  static Future<void> openInstallSourceSettings() async {
    await _ch.invokeMethod<void>('openInstallSourceSettings');
  }

  /// Запустить системный installer для скачанного APK. Возвращает true если
  /// интент успешно стартовал. Не означает что user согласился — после
  /// установки app перезапускается.
  static Future<bool> installApk(String path) async {
    final ok = await _ch.invokeMethod<bool>('installApk', {'path': path});
    return ok ?? false;
  }

  /// Очистить cache `external-cache/updates/`. Идемпотентно.
  static Future<void> cleanupCache() async {
    await _ch.invokeMethod<void>('cleanupCache');
  }
}
