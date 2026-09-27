import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// v0.56.0 — мост к нативному `AppUpdater.kt` (самообновление с собственного
/// сервера через PackageInstaller). Проверка, скачивание и установка — целиком
/// в Kotlin: тот же код гоняет фоновый `AppUpdateWorker`, когда UI закрыт.
class AppUpdateChannel {
  static const MethodChannel _ch = MethodChannel('pro.periscop.child/updates');

  /// Сохранить адрес API для фонового worker'а и поставить периодическую
  /// проверку (идемпотентно).
  static Future<void> configure(String apiBaseUrl) =>
      _ch.invokeMethod<void>('configure', {'apiBaseUrl': apiBaseUrl});

  static Future<AppUpdateStatus> getStatus() => _status('getStatus');

  /// Проверить и скачать в фоне. Прогресс — через [getStatus].
  static Future<AppUpdateStatus> checkNow() => _status('checkNow');

  /// Установить скачанное обновление. Приложение перезапустится.
  static Future<AppUpdateStatus> installNow() => _status('installNow');

  /// Разрешена ли нам «Установка неизвестных приложений».
  static Future<bool> canRequestInstall() async =>
      await _ch.invokeMethod<bool>('canRequestInstall') ?? false;

  /// Системный экран «Установка неизвестных приложений» на нашем пакете.
  static Future<void> openInstallSettings() =>
      _ch.invokeMethod<void>('openInstallSettings');

  static Future<AppUpdateStatus> _status(String method) async {
    final map = await _ch.invokeMapMethod<String, Object?>(method);
    return AppUpdateStatus.fromMap(map ?? const {});
  }
}

enum AppUpdatePhase {
  idle,
  checking,
  upToDate,
  downloading,
  ready,
  installing,
  pendingUserAction,
  failed,
}

@immutable
class AppUpdateStatus {
  const AppUpdateStatus({
    required this.phase,
    this.version,
    this.received = 0,
    this.total = 0,
    this.canRequestInstall = false,
    this.lastCheckAt,
    this.lastError,
    this.lastErrorStage,
  });

  factory AppUpdateStatus.fromMap(Map<String, Object?> m) {
    final lastCheckMs = (m['lastCheckAt'] as num?)?.toInt() ?? 0;
    return AppUpdateStatus(
      phase: _phaseOf(m['phase'] as String?),
      version: m['version'] as String?,
      received: (m['received'] as num?)?.toInt() ?? 0,
      total: (m['total'] as num?)?.toInt() ?? 0,
      canRequestInstall: m['canRequestInstall'] as bool? ?? false,
      lastCheckAt: lastCheckMs > 0
          ? DateTime.fromMillisecondsSinceEpoch(lastCheckMs)
          : null,
      lastError: m['lastError'] as String?,
      lastErrorStage: m['lastErrorStage'] as String?,
    );
  }

  final AppUpdatePhase phase;

  /// Версия, до которой обновляемся ("0.56.0"), если обновление найдено.
  final String? version;
  final int received;
  final int total;
  final bool canRequestInstall;
  final DateTime? lastCheckAt;
  final String? lastError;

  /// 'check' | 'download' | 'install' — на каком шаге упали.
  final String? lastErrorStage;

  /// Идёт работа — баннер опрашивает статус.
  bool get isBusy =>
      phase == AppUpdatePhase.checking ||
      phase == AppUpdatePhase.downloading ||
      phase == AppUpdatePhase.installing;

  /// 0..1 или null, пока размер неизвестен.
  double? get progress => total > 0 ? (received / total).clamp(0.0, 1.0) : null;

  static AppUpdatePhase _phaseOf(String? raw) => switch (raw) {
        'checking' => AppUpdatePhase.checking,
        'up_to_date' => AppUpdatePhase.upToDate,
        'downloading' => AppUpdatePhase.downloading,
        'ready' => AppUpdatePhase.ready,
        'installing' => AppUpdatePhase.installing,
        'pending_user_action' => AppUpdatePhase.pendingUserAction,
        'failed' => AppUpdatePhase.failed,
        _ => AppUpdatePhase.idle,
      };
}
