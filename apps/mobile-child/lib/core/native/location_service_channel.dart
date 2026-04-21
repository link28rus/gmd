import 'package:flutter/services.dart';

// Локации, батарея и состояние связи обрабатываются в headless Dart-изоляте
// фонового сервиса (см. lib/background/location_entry.dart) — UI сюда только
// стартует/останавливает native foreground-service.
class LocationServiceChannel {
  static const MethodChannel _channel =
      MethodChannel('ru.link28rus.gmd.child/location');

  Future<void> startService() async {
    await _channel.invokeMethod('startService');
  }

  Future<void> stopService() async {
    await _channel.invokeMethod('stopService');
  }
}
