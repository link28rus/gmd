import 'package:flutter/services.dart';

// Канал для управления SoundAroundService на native-стороне (Android FGS для
// микрофона). Поднимается по START_AUDIO команде, опускается по STOP.
//
// Native-сторона при start запускает headless FlutterEngine с entry-point
// `soundAroundEntryPoint` (см. lib/features/sound_around/sound_around_entry.dart),
// которому через background channel пробрасывает sessionId/turnCreds/durationSec.
// Реализация в Kotlin (SoundAroundService): foreground service, запуск микрофона,
// захват audio и отправка на TURN-сервер.
//
// Важно: канал регистрируется в main-engine (UI-engine), потому что команды
// START_AUDIO/STOP приходят из ingestor'а в background-engine и пробрасываются
// в UI-engine через platform-channel callback.
class SoundAroundChannel {
  static const MethodChannel _channel =
      MethodChannel('gmd.child/sound_around');

  /// Запустить FGS с переданным контекстом сессии.
  /// Native: startForegroundService(SoundAroundService) + startForeground +
  /// поднимает FlutterEngine с background isolate.
  Future<void> start({
    required String sessionId,
    required Map<String, dynamic> turnCreds, // {url, username, password, ttl}
    required int durationSec,
  }) async {
    await _channel.invokeMethod('start', {
      'sessionId': sessionId,
      'turnCreds': turnCreds,
      'durationSec': durationSec,
    });
  }

  /// Остановить FGS (например, по STOP_AUDIO команде или duration timeout).
  /// Native: stopForeground(STOP_FOREGROUND_REMOVE) + stopSelf + кила engine.
  Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
