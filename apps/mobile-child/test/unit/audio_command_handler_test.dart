import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/core/api/child_api.dart';
import 'package:periscop_child/core/native/sound_around_channel.dart';
import 'package:periscop_child/features/sound_around/audio_command_handler.dart';
import 'package:mocktail/mocktail.dart';

class _MockChannel extends Mock implements SoundAroundChannel {}

void main() {
  late _MockChannel channel;
  late AudioCommandHandler handler;

  setUp(() {
    channel = _MockChannel();
    handler = AudioCommandHandler(channel: channel);
  });

  // ── START_AUDIO ──────────────────────────────────────────────────────────

  group('AudioCommandHandler.START_AUDIO', () {
    test('with full payload calls channel.start and returns true', () async {
      when(
        () => channel.start(
          sessionId: any(named: 'sessionId'),
          wsUrl: any(named: 'wsUrl'),
          durationSec: any(named: 'durationSec'),
        ),
      ).thenAnswer((_) async {});

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {
          'sessionId': 's1',
          'ws': {
            'url': 'wss://periscop.test/audio/ws?role=child&sessionId=s1&token=xxx',
            'token': 'xxx',
            'ttlSec': 360,
          },
          'durationSec': 60,
        },
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verify(
        () => channel.start(
          sessionId: 's1',
          wsUrl: 'wss://periscop.test/audio/ws?role=child&sessionId=s1&token=xxx',
          durationSec: 60,
        ),
      ).called(1);
    });

    test('without payload returns true (ack to drop), no channel call', () async {
      final cmd = DeviceCommand(id: 'c1', type: 'START_AUDIO', payload: null);

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verifyNever(
        () => channel.start(
          sessionId: any(named: 'sessionId'),
          wsUrl: any(named: 'wsUrl'),
          durationSec: any(named: 'durationSec'),
        ),
      );
    });

    test('with malformed payload (missing ws.url) returns true, no channel call', () async {
      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {'sessionId': 's1', 'ws': {}, 'durationSec': 60},
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verifyNever(
        () => channel.start(
          sessionId: any(named: 'sessionId'),
          wsUrl: any(named: 'wsUrl'),
          durationSec: any(named: 'durationSec'),
        ),
      );
    });

    test('with malformed payload (missing durationSec) returns true, no channel call', () async {
      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {
          'sessionId': 's1',
          'ws': {'url': 'wss://x', 'token': 't', 'ttlSec': 60},
        },
      );

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
      verifyNever(
        () => channel.start(
          sessionId: any(named: 'sessionId'),
          wsUrl: any(named: 'wsUrl'),
          durationSec: any(named: 'durationSec'),
        ),
      );
    });

    test('when channel.start throws returns false (skip ack for retry)', () async {
      when(
        () => channel.start(
          sessionId: any(named: 'sessionId'),
          wsUrl: any(named: 'wsUrl'),
          durationSec: any(named: 'durationSec'),
        ),
      ).thenThrow(Exception('FGS start failed'));

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {
          'sessionId': 's1',
          'ws': {'url': 'wss://x', 'token': 't', 'ttlSec': 60},
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

    test('returns true even when channel.stop throws (STOP идемпотентен)', () async {
      when(() => channel.stop()).thenThrow(Exception('already stopped'));

      final cmd = DeviceCommand(id: 'c1', type: 'STOP_AUDIO', payload: null);

      final ok = await handler.handle(cmd);

      expect(ok, isTrue);
    });
  });

  // ── Unknown command ──────────────────────────────────────────────────────

  test('unknown command type returns false (\u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440 PLAY_SIGNAL — \u043d\u0435 \u043d\u0430\u0448 handler)', () async {
    final cmd = DeviceCommand(id: 'c1', type: 'PLAY_SIGNAL', payload: {});

    final ok = await handler.handle(cmd);

    expect(ok, isFalse);
  });

  // v0.35: AUDIO_ANSWER больше не пересылается backend'ом — handler возвращает
  // false (unknown command) даже если кто-то старый его пришлёт.
  test('AUDIO_ANSWER (legacy) treated as unknown — returns false', () async {
    final cmd = DeviceCommand(
      id: 'c1',
      type: 'AUDIO_ANSWER',
      payload: {'sessionId': 's1', 'sdp': 'v=0'},
    );

    final ok = await handler.handle(cmd);

    expect(ok, isFalse);
  });
}
