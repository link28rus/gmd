import 'package:flutter/services.dart';

// Канал для управления громким сигналом на телефоне ребёнка. Реализация в
// Kotlin (SignalSoundService): max volume на STREAM_ALARM, MediaPlayer с
// дефолтным alarm-рингтоном, вибрация, автостоп через 60 секунд.
//
// Важно: канал регистрируется в background-engine (LocationForegroundService),
// потому что ingestor — и значит опрос команд — работает именно в headless
// изоляте, а не в UI-engine.
class SignalChannel {
  static const MethodChannel _channel =
      MethodChannel('ru.link28rus.gmd.child/signal');

  Future<void> play() async {
    await _channel.invokeMethod('play');
  }
}
