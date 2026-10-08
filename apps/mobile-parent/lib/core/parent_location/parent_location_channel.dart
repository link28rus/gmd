import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Состояние нативной службы геолокации родителя (`ParentLocationService.kt`).
@immutable
class ParentLocationNativeStatus {
  const ParentLocationNativeStatus({
    this.running = false,
    this.hasToken = false,
    this.enabled = false,
    this.authFailed = false,
    this.buffered = 0,
    this.lastUploadAt,
    this.lastError,
  });

  /// Служба запущена и подписана на точки.
  final bool running;
  final bool hasToken;

  /// Флаг «показывать меня семье» в нативных кредах (сторож и автозапуск
  /// после перезагрузки смотрят на него).
  final bool enabled;

  /// Сервер ответил 401 на отправку точек — токен стёрт, нужен новый.
  final bool authFailed;

  /// Точек ждёт отправки.
  final int buffered;
  final DateTime? lastUploadAt;
  final String? lastError;

  static const unknown = ParentLocationNativeStatus();

  factory ParentLocationNativeStatus.fromMap(Object? raw) {
    if (raw is! Map) return unknown;
    final lastUploadMs = raw['lastUploadAtMs'];
    return ParentLocationNativeStatus(
      running: raw['running'] == true,
      hasToken: raw['hasToken'] == true,
      enabled: raw['enabled'] == true,
      authFailed: raw['authFailed'] == true,
      buffered: raw['buffered'] is int ? raw['buffered'] as int : 0,
      lastUploadAt: lastUploadMs is int && lastUploadMs > 0
          ? DateTime.fromMillisecondsSinceEpoch(lastUploadMs)
          : null,
      lastError: raw['lastError'] as String?,
    );
  }
}

/// Канал `pro.periscop.parent/location` к нативной службе (MainActivity.kt).
class ParentLocationChannel {
  ParentLocationChannel._();

  static const _channel = MethodChannel('pro.periscop.parent/location');

  /// Сохранить креды для службы (отдельные SharedPreferences на стороне
  /// Kotlin). Сбрасывает признак `authFailed`.
  static Future<void> saveCreds({
    required String baseUrl,
    required String token,
    required String deviceId,
    required bool enabled,
  }) => _channel.invokeMethod<void>('saveCreds', {
    'baseUrl': baseUrl,
    'token': token,
    'deviceId': deviceId,
    'enabled': enabled,
  });

  /// Стереть креды и буфер точек.
  static Future<void> clearCreds() => _channel.invokeMethod<void>('clearCreds');

  /// Включить флаг и запустить службу + сторож WorkManager. false — нет
  /// токена или разрешения на геолокацию.
  static Future<bool> start() async => (await _channel.invokeMethod<bool>('start')) ?? false;

  /// Выключить флаг, остановить службу и сторож. Токен остаётся.
  static Future<void> stop() => _channel.invokeMethod<void>('stop');

  static Future<ParentLocationNativeStatus> status() async =>
      ParentLocationNativeStatus.fromMap(await _channel.invokeMethod<Object?>('status'));
}
