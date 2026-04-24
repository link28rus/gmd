import 'package:flutter/services.dart';

/// Канал для управления SoundAroundService на native-стороне (Android FGS для
/// микрофона). Поднимается по START_AUDIO команде, опускается по STOP.
///
/// v0.35: вместо TURN-кредов теперь передаём координаты подключения к
/// WebSocket-relay backend'а (`wsUrl` уже содержит query с role/sessionId/token).
/// Native-сторона при start запускает headless FlutterEngine с entry-point
/// `soundAroundEntryPoint`, которому через background channel пробрасывает
/// sessionId/wsUrl/durationSec.
///
/// Канал регистрируется в обоих engine'ах (UI + background) — иначе вызов из
/// background isolate (poll-цикл) падает с MissingPluginException, см.
/// commit 04cdaee / Plan E E2E v0.34.2.
class SoundAroundChannel {
  static const MethodChannel _channel = MethodChannel('gmd.child/sound_around');

  /// Запустить FGS с переданным контекстом сессии.
  /// Native: startForegroundService(SoundAroundService) + startForeground +
  /// поднимает FlutterEngine с background isolate.
  Future<void> start({
    required String sessionId,
    required String wsUrl,
    required int durationSec,
  }) async {
    await _channel.invokeMethod('start', {
      'sessionId': sessionId,
      'wsUrl': wsUrl,
      'durationSec': durationSec,
    });
  }

  /// Остановить FGS (например, по STOP_AUDIO команде или duration timeout).
  /// Native: stopForeground(STOP_FOREGROUND_REMOVE) + stopSelf + кила engine.
  Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
