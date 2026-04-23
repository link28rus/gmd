import 'dart:async';

import '../../core/api/child_api.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/native/sound_around_channel.dart';

const _tag = 'AudioCommandHandler';

/// Обрабатывает audio-команды из poll'а [DeviceCommand]'ов:
///  - START_AUDIO — поднимает FGS через [SoundAroundChannel.start]
///  - STOP_AUDIO  — останавливает FGS через [SoundAroundChannel.stop]
///  - AUDIO_ANSWER — пробрасывает SDP-answer в background engine через
///                   [SoundAroundChannel.deliverAnswer]
///
/// Возвращает true если команда обработана и следует отправить ack серверу;
/// false — если команда не наша (неизвестный тип) или START_AUDIO упал
/// (пусть сервер переотдаст при следующем poll).
///
/// Используется в [location_entry.dart] как расширение onCommand-коллбека.
class AudioCommandHandler {
  AudioCommandHandler({SoundAroundChannel? channel})
      : _channel = channel ?? SoundAroundChannel();

  final SoundAroundChannel _channel;

  Future<bool> handle(DeviceCommand cmd) async {
    switch (cmd.type) {
      case 'START_AUDIO':
        return _handleStart(cmd);
      case 'STOP_AUDIO':
        return _handleStop(cmd);
      case 'AUDIO_ANSWER':
        return _handleAnswer(cmd);
      default:
        return false; // не наша команда
    }
  }

  Future<bool> _handleStart(DeviceCommand cmd) async {
    final payload = cmd.payload;
    if (payload == null) {
      unawaited(diagLog(_tag, 'START_AUDIO without payload — ignored'));
      return true; // ack чтобы не повторялась
    }
    final sessionId = payload['sessionId'] as String?;
    final turnCreds = (payload['turnCreds'] as Map?)?.cast<String, dynamic>();
    final durationSec = payload['durationSec'] as int?;
    if (sessionId == null || turnCreds == null || durationSec == null) {
      unawaited(diagLog(_tag, 'START_AUDIO malformed payload — ignored'));
      return true; // ack чтобы не повторялась
    }
    unawaited(diagLog(
      _tag,
      'START_AUDIO sessionId=$sessionId duration=${durationSec}s',
    ));
    try {
      await _channel.start(
        sessionId: sessionId,
        turnCreds: turnCreds,
        durationSec: durationSec,
      );
      return true;
    } catch (e) {
      unawaited(diagLog(_tag, 'START_AUDIO channel.start failed: $e'));
      return false; // не ack — ретрай при следующем poll
    }
  }

  Future<bool> _handleStop(DeviceCommand cmd) async {
    unawaited(diagLog(
      _tag,
      'STOP_AUDIO sessionId=${cmd.payload?['sessionId']}',
    ));
    try {
      await _channel.stop();
      return true;
    } catch (e) {
      unawaited(diagLog(_tag, 'STOP_AUDIO channel.stop failed: $e'));
      return true; // ack даже при ошибке — STOP идемпотентен
    }
  }

  Future<bool> _handleAnswer(DeviceCommand cmd) async {
    final payload = cmd.payload;
    if (payload == null) {
      unawaited(diagLog(_tag, 'AUDIO_ANSWER without payload — ignored'));
      return true; // ack чтобы не повторялась
    }
    final sessionId = payload['sessionId'] as String?;
    final sdp = payload['sdp'] as String?;
    if (sessionId == null || sdp == null) {
      unawaited(diagLog(_tag, 'AUDIO_ANSWER malformed payload — ignored'));
      return true;
    }
    unawaited(diagLog(
      _tag,
      'AUDIO_ANSWER sessionId=$sessionId len=${sdp.length}',
    ));
    try {
      await _channel.deliverAnswer(sessionId: sessionId, sdp: sdp);
      return true;
    } catch (e) {
      unawaited(diagLog(_tag, 'AUDIO_ANSWER deliverAnswer failed: $e'));
      // Ack в любом случае — answer одноразовый, ретрай не поможет.
      return true;
    }
  }
}
