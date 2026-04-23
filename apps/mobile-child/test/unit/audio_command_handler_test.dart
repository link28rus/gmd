import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/core/native/sound_around_channel.dart';
import 'package:gmd_child/features/sound_around/audio_command_handler.dart';
import 'package:mocktail/mocktail.dart';

class _MockChannel extends Mock implements SoundAroundChannel {}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  late _MockChannel channel;
  late AudioCommandHandler handler;

  setUp(() {
    channel = _MockChannel();
    handler = AudioCommandHandler(channel: channel);
  });

  // ── START_AUDIO ──────────────────────────────────────────────────────────

  group('AudioCommandHandler.START_AUDIO', () {
    test('with full payload calls channel.start and returns true', () async {
      when(() => channel.start(
            sessionId: any(named: 'sessionId'),
            turnCreds: any(named: 'turnCreds'),
            durationSec: any(named: 'durationSec'),
          )).thenAnswer((_) async {});

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {
          'sessionId': 's1',
          'turnCreds': {
            'url': 'turn:x',
            'username': 'u',
            'password': 'p',
            'ttl': 600,
          },
          'durationSec': 60,
        },
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verify(() => channel.start(
            sessionId: 's1',
            turnCreds: any(named: 'turnCreds'),
            durationSec: 60,
          )).called(1);
    });

    test('without payload returns true (ack to drop), no channel call',
        () async {
      final cmd = DeviceCommand(id: 'c1', type: 'START_AUDIO', payload: null);

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verifyNever(() => channel.start(
            sessionId: any(named: 'sessionId'),
            turnCreds: any(named: 'turnCreds'),
            durationSec: any(named: 'durationSec'),
          ));
    });

    test('with malformed payload (missing durationSec) returns true, no channel call',
        () async {
      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {'sessionId': 's1', 'turnCreds': {}}, // durationSec отсутствует
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verifyNever(() => channel.start(
            sessionId: any(named: 'sessionId'),
            turnCreds: any(named: 'turnCreds'),
            durationSec: any(named: 'durationSec'),
          ));
    });

    test('when channel.start throws returns false (skip ack for retry)',
        () async {
      when(() => channel.start(
            sessionId: any(named: 'sessionId'),
            turnCreds: any(named: 'turnCreds'),
            durationSec: any(named: 'durationSec'),
          )).thenThrow(Exception('FGS start failed'));

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {
          'sessionId': 's1',
          'turnCreds': {'url': 'turn:x', 'username': 'u', 'password': 'p'},
          'durationSec': 30,
        },
      );

      final ok = await handler.handle(cmd);

      expect(ok, isFalse);
    });
  });

  // ── STOP_AUDIO ───────────────────────────────────────────────────────────

  group('AudioCommandHandler.STOP_AUDIO', () {
    test('calls channel.stop and returns true', () async {
      when(() => channel.stop()).thenAnswer((_) async {});

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'STOP_AUDIO',
        payload: {'sessionId': 's1'},
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verify(() => channel.stop()).called(1);
    });

    test('returns true even when channel.stop throws (STOP идемпотентен)',
        () async {
      when(() => channel.stop()).thenThrow(Exception('already stopped'));

      final cmd =
          DeviceCommand(id: 'c1', type: 'STOP_AUDIO', payload: null);

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
    });
  });

  // ── AUDIO_ANSWER ─────────────────────────────────────────────────────────

  group('AudioCommandHandler.AUDIO_ANSWER', () {
    test('with full payload calls deliverAnswer and returns true', () async {
      when(() => channel.deliverAnswer(
            sessionId: any(named: 'sessionId'),
            sdp: any(named: 'sdp'),
          )).thenAnswer((_) async {});

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'AUDIO_ANSWER',
        payload: {'sessionId': 's1', 'sdp': 'v=0\r\n...'},
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verify(() => channel.deliverAnswer(
            sessionId: 's1',
            sdp: 'v=0\r\n...',
          )).called(1);
    });

    test('without payload returns true (ack to drop), no channel call',
        () async {
      final cmd =
          DeviceCommand(id: 'c1', type: 'AUDIO_ANSWER', payload: null);

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verifyNever(() => channel.deliverAnswer(
            sessionId: any(named: 'sessionId'),
            sdp: any(named: 'sdp'),
          ));
    });

    test('returns true even if deliverAnswer throws (answer одноразовый)',
        () async {
      when(() => channel.deliverAnswer(
            sessionId: any(named: 'sessionId'),
            sdp: any(named: 'sdp'),
          )).thenThrow(Exception('FGS not active'));

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'AUDIO_ANSWER',
        payload: {'sessionId': 's1', 'sdp': 'v=0'},
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
    });
  });

  // ── Unknown command ──────────────────────────────────────────────────────

  test('unknown command type returns false', () async {
    final cmd = DeviceCommand(id: 'c1', type: 'PLAY_SIGNAL', payload: {});

    final ok = await handler.handle(cmd);

    expect(ok, isFalse);
  });
}
