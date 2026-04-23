import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../core/api/api_exceptions.dart';
import '../../core/api/audio_api.dart';
import '../../core/config/env.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/storage/secure_storage_service.dart';

typedef StopRequestCallback = void Function({String? reason});

const _tag = 'SoundAround';

/// Управляет lifecycle одной audio-сессии:
/// - setup PeerConnection с force-relay TURN-конфигом
/// - захват микрофона (echoCancellation/noiseSuppression/AGC)
/// - SDP-offer → POST /child/audio/sessions/:id/ready
/// - ICE-candidates → POST /ice (trickle)
/// - applyAnswer(sdp) — вызывается из AudioCommandHandler при AUDIO_ANSWER (Task 9)
/// - auto-stop по durationSec timeout
/// - явный stop по STOP_AUDIO команде
///
/// Ошибки: getUserMedia denied/busy / network / unknown → POST /error +
/// onStopRequest(reason). Идемпотентно: повторный stop — no-op.
class SoundAroundController {
  SoundAroundController({
    required this.onStopRequest,
    AudioApi? audioApi,
    SecureStorageService? storage,
  })  : _audioApi = audioApi ?? AudioApi(_buildDio()),
        _storage = storage ?? SecureStorageService();

  final StopRequestCallback onStopRequest;
  final AudioApi _audioApi;
  final SecureStorageService _storage;

  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  Timer? _autoStopTimer;
  String? _deviceToken;
  bool _stopped = false;

  static Dio _buildDio() => Dio(BaseOptions(
        baseUrl: apiBaseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 30),
      ));

  Future<void> start({
    required String sessionId,
    required Map<String, dynamic> turnCreds,
    required int durationSec,
  }) async {
    _deviceToken = await _storage.readDeviceToken();
    if (_deviceToken == null || _deviceToken!.isEmpty) {
      unawaited(diagLog(_tag, 'no device token — cannot signal'));
      onStopRequest(reason: 'no_token');
      return;
    }

    unawaited(diagLog(_tag, 'start sessionId=$sessionId duration=${durationSec}s'));

    try {
      // 1) Configure PeerConnection с TURN-credentials.
      final config = <String, dynamic>{
        'iceServers': [
          {
            'urls': turnCreds['url'],
            'username': turnCreds['username'],
            'credential': turnCreds['password'],
          },
        ],
        'iceTransportPolicy': 'relay', // force-relay
      };
      _pc = await createPeerConnection(config);

      // 2) ICE-candidate listener — отправляем на backend.
      _pc!.onIceCandidate = (cand) {
        if (cand.candidate == null || _stopped) return;
        unawaited(
          _audioApi
              .sendIce(
                sessionId: sessionId,
                deviceToken: _deviceToken!,
                candidate: cand.candidate!,
              )
              .catchError((Object e) {
            unawaited(diagLog(_tag, 'sendIce failed: $e'));
          }),
        );
      };

      _pc!.onConnectionState = (state) {
        unawaited(diagLog(_tag, 'connection state: $state'));
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            state == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
          unawaited(stop(reason: 'connection_$state'));
        }
      };

      // 3) Захват микрофона (требует RECORD_AUDIO permission).
      final stream = await navigator.mediaDevices.getUserMedia({
        'audio': {
          'echoCancellation': true,
          'noiseSuppression': true,
          'autoGainControl': true,
        },
        'video': false,
      });
      _localStream = stream;
      for (final track in stream.getAudioTracks()) {
        await _pc!.addTrack(track, stream);
      }

      // 4) Создать SDP-offer и отправить.
      final offer = await _pc!.createOffer({'offerToReceiveAudio': false});
      await _pc!.setLocalDescription(offer);
      await _audioApi.sendReady(
        sessionId: sessionId,
        deviceToken: _deviceToken!,
        sdp: offer.sdp!,
      );

      // 5) Auto-stop таймер (durationSec + 5с буфер).
      _autoStopTimer = Timer(Duration(seconds: durationSec + 5), () {
        unawaited(diagLog(_tag, 'auto-stop по durationSec timeout'));
        unawaited(stop(reason: 'duration_timeout'));
      });

      unawaited(diagLog(_tag, 'READY отправлен, ждём AUDIO_ANSWER + ICE'));
    } on Exception catch (e) {
      unawaited(diagLog(_tag, 'start failed: $e'));
      String code = 'UNKNOWN';
      final msg = e.toString().toLowerCase();
      if (msg.contains('notallowed') || msg.contains('permission')) {
        code = 'PERMISSION_DENIED';
      } else if (msg.contains('busy') || msg.contains('in use')) {
        code = 'MIC_BUSY';
      } else if (e is NetworkException) {
        code = 'NETWORK_ERROR';
      }
      try {
        await _audioApi.sendError(
          sessionId: sessionId,
          deviceToken: _deviceToken ?? '',
          code: code,
          message: e.toString(),
        );
      } catch (_) {
        // best-effort: если не можем сообщить backend — просто стопаемся
      }
      await stop(reason: 'start_failed');
    }
  }

  /// Применить SDP-answer от parent. Вызывается из AudioCommandHandler при
  /// получении AUDIO_ANSWER команды (Task 9, v0.32.1+).
  Future<void> applyAnswer(String sdp) async {
    if (_pc == null || _stopped) {
      unawaited(diagLog(_tag, 'applyAnswer skipped: pc=$_pc stopped=$_stopped'));
      return;
    }
    try {
      final desc = RTCSessionDescription(sdp, 'answer');
      await _pc!.setRemoteDescription(desc);
      unawaited(diagLog(_tag, 'answer applied — handshake complete, ждём audio flow'));
    } catch (e) {
      unawaited(diagLog(_tag, 'applyAnswer failed: $e'));
    }
  }

  Future<void> stop({String? reason}) async {
    if (_stopped) return;
    _stopped = true;
    _autoStopTimer?.cancel();
    unawaited(diagLog(_tag, 'stop reason=$reason'));
    try {
      _localStream?.getTracks().forEach((t) => t.stop());
      await _localStream?.dispose();
      await _pc?.close();
    } catch (e) {
      unawaited(diagLog(_tag, 'stop cleanup error: $e'));
    }
    onStopRequest(reason: reason);
  }
}
