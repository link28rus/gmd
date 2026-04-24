import 'dart:async';

import '../../core/api/child_api.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/native/sound_around_channel.dart';

const _tag = 'AudioCommandHandler';

/// Обрабатывает audio-команды из poll'а [DeviceCommand]'ов:
///  - START_AUDIO — поднимает FGS через [SoundAroundChannel.start]
///  - STOP_AUDIO  — останавливает FGS через [SoundAroundChannel.stop]
///
/// Возвращает true если команда обработана и следует отправить ack серверу;
/// false — если команда не наша (неизвестный тип) или START_AUDIO упал
/// (пусть сервер переотдаст при следующем poll).
///
/// v0.35: AUDIO_ANSWER убран (переход с WebRTC SDP signaling на WebSocket-
/// relay). Координаты WS приходят в payload START_AUDIO команды:
/// `{sessionId, ws: {url, token, ttlSec}, durationSec}`.
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
    final ws = (payload['ws'] as Map?)?.cast<String, dynamic>();
    final wsUrl = ws?['url'] as String?;
    final durationSec = payload['durationSec'] as int?;
    if (sessionId == null || wsUrl == null || wsUrl.isEmpty || durationSec == null) {
      unawaited(diagLog(_tag, 'START_AUDIO malformed payload — ignored'));
      return true; // ack чтобы не повторялась
    }
    unawaited(
      diagLog(_tag, 'START_AUDIO sessionId=$sessionId duration=${durationSec}s'),
    );
    try {
      await _channel.start(
        sessionId: sessionId,
        wsUrl: wsUrl,
        durationSec: durationSec,
      );
      return true;
    } catch (e) {
      unawaited(diagLog(_tag, 'START_AUDIO channel.start failed: $e'));
      return false; // не ack — ретрай при следующем poll
    }
  }

  Future<bool> _handleStop(DeviceCommand cmd) async {
    unawaited(
      diagLog(_tag, 'STOP_AUDIO sessionId=${cmd.payload?['sessionId']}'),
    );
    try {
      await _channel.stop();
      return true;
    } catch (e) {
      unawaited(diagLog(_tag, 'STOP_AUDIO channel.stop failed: $e'));
      return true; // ack даже при ошибке — STOP идемпотентен
    }
  }
}
