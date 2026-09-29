import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:opus_dart/opus_dart.dart';
import 'package:record/record.dart';

import '../../core/api/audio_api.dart';
import '../../core/config/env.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/storage/secure_storage_service.dart';

typedef StopRequestCallback = void Function({String? reason});

const _tag = 'SoundAround';

// 16 kHz mono PCM 16 бит — стандартный набор для VOIP-Opus, минимальный битрейт.
// 20-мс кадр = 320 семплов = 640 байт PCM. Opus encoder возвращает ~40-80 байт/кадр.
const int _sampleRateHz = 16000;
const int _frameDurationMs = 20;
const int _frameSamples = _sampleRateHz * _frameDurationMs ~/ 1000; // 320
const int _frameBytes = _frameSamples * 2; // Int16 little-endian

/// Управляет lifecycle одной audio-сессии (v0.35: WebSocket + Opus).
///
/// Поток:
///   record.startStream(PCM 16k mono)
///     → BytesBuilder (накапливает до 20-мс кадра = 640 байт)
///       → SimpleOpusEncoder.encode(Int16List 320 семплов)
///         → WebSocket(/audio/ws?role=child&sessionId=…&token=…).add(Opus bytes)
///
/// Init Opus делается один раз на изолят в [soundAroundEntryPoint] —
/// перед вызовом [start] обязательно `await _opusReady`.
///
/// Ошибки:
///  - permission denied / mic busy / network → WS control-frame {op:'error', code}
///    + best-effort HTTP fallback POST /child/audio/sessions/:id/error
///  - auto-stop по `durationSec + 5с буфер` → onStopRequest(reason: 'duration_timeout')
///  - WS закрылся (4006/4008/иное) → onStopRequest(reason: 'ws_closed')
///
/// Идемпотентно: повторный stop — no-op.
class SoundAroundController {
  SoundAroundController({
    required this.onStopRequest,
    AudioRecorder? recorder,
    AudioApi? audioApi,
    SecureStorageService? storage,
  }) : _recorder = recorder ?? AudioRecorder(),
       _audioApi = audioApi ?? AudioApi(_buildDio()),
       _storage = storage ?? SecureStorageService();

  final StopRequestCallback onStopRequest;
  final AudioRecorder _recorder;
  final AudioApi _audioApi;
  final SecureStorageService _storage;

  WebSocket? _ws;
  StreamSubscription<Uint8List>? _pcmSub;
  SimpleOpusEncoder? _encoder;
  Timer? _autoStopTimer;
  bool _stopped = false;
  final BytesBuilder _byteBuffer = BytesBuilder(copy: false);
  // v0.60.0: счётчики для подробного журнала (diagDebug).
  bool _firstChunkLogged = false;
  int _framesSent = 0;

  static Dio _buildDio() => Dio(
    BaseOptions(
      baseUrl: apiBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ),
  );

  Future<void> start({
    required String sessionId,
    required String wsUrl,
    required int durationSec,
  }) async {
    unawaited(diagLog(_tag, 'start sessionId=$sessionId duration=${durationSec}s'));
    // v0.60.0: на каком шаге упал старт — для журнала на сервере.
    var stage = 'permission_check';

    try {
      // v0.35.0-rc.5: НЕ проверяем _recorder.hasPermission() — record_android 6.x
      // в headless isolate без Activity возвращает false даже при granted-permission
      // (нет ActivityCompat.checkSelfPermission fallback). Сразу пробуем startStream;
      // если permission реально нет — Android кинет SecurityException, поймаем
      // в catch и отчитаемся PERMISSION_DENIED. См. v0.35 incident report.
      final permStatusLog = await _recorder.hasPermission();
      unawaited(diagLog(_tag, 'recorder.hasPermission()=$permStatusLog (advisory only)'));

      stage = 'opus_encoder';

      // Encoder создаётся per-сессию, чтобы освобождать ресурсы при stop().
      // Application.voip — самый агрессивный режим компрессии для голоса.
      _encoder = SimpleOpusEncoder(
        sampleRate: _sampleRateHz,
        channels: 1,
        application: Application.voip,
      );

      unawaited(diagDebug(_tag, 'opus encoder created'));

      // WebSocket: URL уже содержит query (?role=child&sessionId=…&token=…),
      // выдан backend'ом в payload START_AUDIO команды.
      stage = 'ws_connect';
      final wsUri = Uri.tryParse(wsUrl);
      unawaited(diagDebug(
        _tag,
        'ws connect attempt host=${wsUri?.host}:${wsUri?.port} path=${wsUri?.path}',
      ));
      final connectStartedAt = DateTime.now();
      _ws = await WebSocket.connect(wsUrl);
      final connectMs = DateTime.now().difference(connectStartedAt).inMilliseconds;
      unawaited(diagDebug(_tag, 'ws connected in ${connectMs}ms'));
      _ws!.listen(
        (dynamic data) {
          // Backend control-frames в эту сторону не шлёт сейчас; молча игнорируем.
        },
        onError: (dynamic e) {
          unawaited(diagLog(_tag, 'ws error: $e'));
          _reportFatal('ws_error');
          unawaited(stop(reason: 'ws_error'));
        },
        onDone: () {
          unawaited(
            diagLog(
              _tag,
              'ws closed code=${_ws?.closeCode} reason=${_ws?.closeReason}',
            ),
          );
          unawaited(stop(reason: 'ws_closed'));
        },
        cancelOnError: true,
      );

      // record v6: startStream возвращает Stream<Uint8List> с raw PCM-байтами.
      // Кадры приходят НЕ ровно по 20ms; накапливаем в BytesBuilder.
      stage = 'recorder_start';
      unawaited(diagDebug(_tag, 'recorder startStream (pcm16 ${_sampleRateHz}Hz mono)'));
      final stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: _sampleRateHz,
          numChannels: 1,
          echoCancel: true,
          noiseSuppress: true,
          autoGain: true,
        ),
      );
      _pcmSub = stream.listen(
        _onPcmChunk,
        onError: (Object e) {
          unawaited(diagLog(_tag, 'record stream error: $e'));
          _reportFatal('record_error');
          unawaited(stop(reason: 'record_error'));
        },
      );
      unawaited(diagDebug(_tag, 'recorder started'));
      stage = 'streaming';

      _autoStopTimer = Timer(Duration(seconds: durationSec + 5), () {
        unawaited(diagLog(_tag, 'auto-stop по durationSec timeout'));
        unawaited(stop(reason: 'duration_timeout'));
      });

      unawaited(diagLog(_tag, 'streaming start OK, ws=open, recorder=running'));
    } on Exception catch (e) {
      unawaited(diagLog(_tag, 'start failed: $e'));
      unawaited(diagDebug(_tag, 'start failed at stage=$stage type=${e.runtimeType}'));
      _reportFatal('start_$stage');
      String code = 'UNKNOWN';
      final msg = e.toString().toLowerCase();
      if (msg.contains('securityexception') ||
          msg.contains('permission') ||
          msg.contains('record_audio') ||
          msg.contains('user denied') ||
          msg.contains('not granted')) {
        code = 'PERMISSION_DENIED';
      } else if (msg.contains('busy') ||
          msg.contains('in use') ||
          msg.contains('errorcode_invalid_state')) {
        code = 'MIC_BUSY';
      } else if (e is SocketException || e is WebSocketException) {
        code = 'NETWORK_ERROR';
      }
      await _reportErrorAndStop(sessionId, code, e.toString());
    } catch (e) {
      // PlatformException и прочее не-Exception
      unawaited(diagLog(_tag, 'start crashed (non-Exception): $e'));
      unawaited(diagDebug(_tag, 'start crashed at stage=$stage type=${e.runtimeType}'));
      _reportFatal('start_$stage');
      String code = 'UNKNOWN';
      final msg = e.toString().toLowerCase();
      if (msg.contains('securityexception') ||
          msg.contains('permission') ||
          msg.contains('record_audio') ||
          msg.contains('not granted')) {
        code = 'PERMISSION_DENIED';
      } else if (msg.contains('busy') || msg.contains('errorcode_invalid_state')) {
        code = 'MIC_BUSY';
      }
      await _reportErrorAndStop(sessionId, code, e.toString());
    }
  }

  void _onPcmChunk(Uint8List bytes) {
    if (_stopped) return;
    if (!_firstChunkLogged) {
      _firstChunkLogged = true;
      unawaited(diagDebug(_tag, 'first PCM chunk ${bytes.length} bytes'));
    }
    _byteBuffer.add(bytes);
    while (_byteBuffer.length >= _frameBytes) {
      // takeBytes() возвращает накопленный буфер и обнуляет builder.
      final all = _byteBuffer.takeBytes();
      // Полные 20-мс кадры пакуем и шлём, остаток (< 640 байт) кладём обратно.
      var offset = 0;
      while (offset + _frameBytes <= all.length) {
        _encodeAndSend(Uint8List.sublistView(all, offset, offset + _frameBytes));
        offset += _frameBytes;
      }
      if (offset < all.length) {
        _byteBuffer.add(Uint8List.sublistView(all, offset));
      }
    }
  }

  void _encodeAndSend(Uint8List frameBytes) {
    final encoder = _encoder;
    final ws = _ws;
    if (encoder == null || ws == null || ws.readyState != WebSocket.open) return;
    try {
      final byteData = ByteData.sublistView(frameBytes);
      final pcm = Int16List(_frameSamples);
      for (var i = 0; i < _frameSamples; i++) {
        pcm[i] = byteData.getInt16(i * 2, Endian.little);
      }
      final opus = encoder.encode(input: pcm);
      ws.add(opus);
      _framesSent++;
      if (_framesSent == 1) {
        unawaited(diagDebug(_tag, 'first Opus frame sent (${opus.length} bytes)'));
      }
    } catch (e) {
      // Один проблемный кадр не должен ронять сессию — следующий через 20ms.
      unawaited(diagLog(_tag, 'encode/send frame failed: $e'));
    }
  }

  /// v0.60.0: фатальный сбой стрима — автоотправка журнала (лимит частоты
  /// и выключатель autoUpload — на native-стороне).
  void _reportFatal(String what) {
    if (_stopped) return;
    unawaited(diagDebug(_tag, 'fatal: $what → auto upload'));
    unawaited(diagUpload(reason: 'auto', trigger: 'audio_stream_failed'));
  }

  Future<void> _reportErrorAndStop(
    String sessionId,
    String code,
    String message,
  ) async {
    final ws = _ws;
    if (ws != null && ws.readyState == WebSocket.open) {
      try {
        ws.add(jsonEncode({'op': 'error', 'code': code, 'message': message}));
      } catch (_) {
        /* ignore */
      }
    }
    // HTTP fallback на случай если WS ещё не подключился.
    try {
      final token = await _storage.readDeviceToken();
      if (token != null && token.isNotEmpty) {
        await _audioApi.sendError(
          sessionId: sessionId,
          deviceToken: token,
          code: code,
          message: message,
        );
      }
    } catch (_) {
      /* best-effort */
    }
    await stop(reason: 'error_$code');
  }

  Future<void> stop({String? reason}) async {
    if (_stopped) return;
    _stopped = true;
    _autoStopTimer?.cancel();
    unawaited(diagLog(_tag, 'stop reason=$reason'));
    unawaited(diagDebug(
      _tag,
      'stop: framesSent=$_framesSent wsState=${_ws?.readyState} '
      'wsClose=${_ws?.closeCode}/${_ws?.closeReason}',
    ));
    try {
      await _pcmSub?.cancel();
      _pcmSub = null;
      if (await _recorder.isRecording()) {
        await _recorder.stop();
      }
      _byteBuffer.clear();
      final ws = _ws;
      if (ws != null && ws.readyState == WebSocket.open) {
        await ws.close(1000, 'child_stop');
      }
      _ws = null;
      _encoder?.destroy();
      _encoder = null;
    } catch (e) {
      unawaited(diagLog(_tag, 'stop cleanup error: $e'));
    }
    onStopRequest(reason: reason);
  }
}
