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

/// v0.81.0 — переключатель «Автозапуск» в MIUI/HyperOS. Без него после
/// перезагрузки или убийства процесса геолокация не поднимается сама.
enum AutostartState {
  enabled,
  disabled,

  /// Прошивка не дала прочитать — плашку не показываем.
  unknown,

  /// Не Xiaomi: переключателя нет.
  notMiui,
}

class LocationServiceChannel {
  static const MethodChannel _channel = MethodChannel('pro.periscop.child/location');

  Future<void> startService() async {
    await _channel.invokeMethod('startService');
  }

  Future<void> stopService() async {
    await _channel.invokeMethod('stopService');
  }

  /// Сервер отозвал токен: остановить сервис и запретить его автозапуск
  /// (загрузка, будильник, Activity Recognition) до повторной привязки.
  Future<void> deviceUnlinked() async {
    await _channel.invokeMethod('deviceUnlinked');
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

  Future<AutostartState> autostartState() async {
    try {
      final raw = await _channel.invokeMethod<String>('autostartState');
      return switch (raw) {
        'ENABLED' => AutostartState.enabled,
        'DISABLED' => AutostartState.disabled,
        'NOT_MIUI' => AutostartState.notMiui,
        _ => AutostartState.unknown,
      };
    } catch (_) {
      return AutostartState.unknown;
    }
  }

  /// Экран «Автозапуск» в «Безопасности» MIUI (или карточка приложения).
  Future<void> openAutostartSettings() async {
    await _channel.invokeMethod('openAutostartSettings');
  }
}
