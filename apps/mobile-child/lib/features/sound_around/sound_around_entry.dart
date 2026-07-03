import 'dart:ui' show DartPluginRegistrant;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:opus_dart/opus_dart.dart';
import 'package:opus_flutter/opus_flutter.dart' as opus_flutter;

import '../../core/diag/diag_channel.dart';
import 'sound_around_controller.dart';

/// Top-level entry-point для headless FlutterEngine, поднятого
/// из SoundAroundService.kt.
///
/// Регистрируется в native через
/// `DartExecutor.DartEntrypoint(
///    bundlePath,
///    "package:periscop_child/features/sound_around/sound_around_entry.dart",
///    "soundAroundEntryPoint"
///  )`.
///
/// PRAGMA: vm:entry-point — без него tree-shaker удалит функцию
/// из release-сборки. AOT-guard также держится в lib/main.dart
/// (см. _keepEntrypoints, см. Plan E v0.34.3 incident).
///
/// v0.35: WebSocket+Opus — initOpus загружает libopus.so однократно через
/// opus_flutter; init может занять 100-300мс на холодном старте, поэтому
/// делается отдельным Future, который ждёт обработчик `init`.
@pragma('vm:entry-point')
void soundAroundEntryPoint() {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();

  diagLog('sound_around', 'soundAroundEntryPoint: starting headless isolate');

  // Init Opus один раз на изолят. opus_flutter.load() возвращает
  // DynamicLibrary с libopus.so из bundled native libs. initOpus —
  // global state opus_dart, повторный вызов в том же изоляте бессмысленен.
  final Future<void> opusReady = (() async {
    try {
      initOpus(await opus_flutter.load());
      diagLog('sound_around', 'opus init OK');
    } catch (e, st) {
      diagLog('sound_around', 'opus init failed: $e\n$st');
    }
  })();

  const bgChannel = MethodChannel('pro.periscop.child/sound_around_bg');

  late final SoundAroundController controller;
  controller = SoundAroundController(
    onStopRequest: ({String? reason}) {
      // Сообщить native, что нужно завершить FGS.
      bgChannel.invokeMethod('stopSelf', {'reason': reason ?? 'unknown'});
    },
  );

  bgChannel.setMethodCallHandler((call) async {
    switch (call.method) {
      case 'init':
        try {
          await opusReady; // ждём загрузку libopus прежде чем стартовать encoder
          final args = (call.arguments as Map).cast<String, dynamic>();
          final sessionId = args['sessionId'] as String;
          final wsUrl = args['wsUrl'] as String;
          final durationSec = args['durationSec'] as int;
          diagLog(
            'sound_around',
            'init sessionId=$sessionId duration=${durationSec}s',
          );
          await controller.start(
            sessionId: sessionId,
            wsUrl: wsUrl,
            durationSec: durationSec,
          );
        } catch (e, st) {
          diagLog('sound_around', 'init failed: $e\n$st');
          await bgChannel.invokeMethod('stopSelf', {'reason': 'init_failed'});
        }
        return null;
      case 'forceStop':
        diagLog('sound_around', 'forceStop from native');
        await controller.stop(reason: 'native_force_stop');
        return null;
      default:
        throw MissingPluginException('Unknown method: ${call.method}');
    }
  });
}
