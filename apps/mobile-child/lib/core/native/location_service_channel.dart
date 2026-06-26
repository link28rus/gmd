import 'package:flutter/services.dart';

// Локации, батарея и состояние связи обрабатываются в headless Dart-изоляте
// фонового сервиса (см. lib/background/location_entry.dart) — UI сюда только
// стартует/останавливает native foreground-service.

enum LocationProfile {
  /// Сервис ещё не стартовал или не записал профиль в SharedPreferences.
  unknown,

  /// Частый GPS (10с / 20м) — ребёнок движется или Activity Recognition не дал STILL.
  active,

  /// Экономичный GPS (5мин / 50м) — Activity Recognition детектит STILL.
  still,
}

class LocationServiceChannel {
  static const MethodChannel _channel = MethodChannel('ru.link28rus.gmd.child/location');

  Future<void> startService() async {
    await _channel.invokeMethod('startService');
  }

  Future<void> stopService() async {
    await _channel.invokeMethod('stopService');
  }

  /// v0.31.2 — читает текущий профиль GPS-сервиса. Native пишет его в
  /// SharedPreferences при каждом `switchProfile`; UI опрашивает этот метод
  /// раз в несколько секунд для chip-индикатора на home-экране.
  Future<LocationProfile> getCurrentProfile() async {
    try {
      final raw = await _channel.invokeMethod<String>('getCurrentProfile');
      return switch (raw) {
        'ACTIVE' => LocationProfile.active,
        'STILL' => LocationProfile.still,
        _ => LocationProfile.unknown,
      };
    } catch (_) {
      return LocationProfile.unknown;
    }
  }
}
