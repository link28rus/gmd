import 'dart:convert';
import 'dart:ui' show DartPluginRegistrant;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../core/diag/diag_channel.dart';
import 'sound_around_controller.dart';

/// Top-level entry-point для headless FlutterEngine, поднятого
/// из SoundAroundService.kt.
///
/// Регистрируется в native через
/// `DartExecutor.DartEntrypoint(
///    bundlePath,
///    "package:gmd_child/features/sound_around/sound_around_entry.dart",
///    "soundAroundEntryPoint"
///  )`.
///
/// PRAGMA: vm:entry-point — без него tree-shaker удалит функцию
/// из release-сборки.
@pragma('vm:entry-point')
void soundAroundEntryPoint() {
  // Bind binding для plugin-registry в background isolate.
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();

  diagLog('sound_around', 'soundAroundEntryPoint: starting headless isolate');

  const bgChannel = MethodChannel('gmd.child/sound_around_bg');

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
          final args = (call.arguments as Map).cast<String, dynamic>();
          final sessionId = args['sessionId'] as String;
          final turnCredsJson = args['turnCredsJson'] as String;
          final durationSec = args['durationSec'] as int;
          final turnCreds =
              (jsonDecode(turnCredsJson) as Map).cast<String, dynamic>();
          diagLog(
            'sound_around',
            'init sessionId=$sessionId duration=${durationSec}s',
          );
          await controller.start(
            sessionId: sessionId,
            turnCreds: turnCreds,
            durationSec: durationSec,
          );
        } catch (e, st) {
          diagLog('sound_around', 'init failed: $e\n$st');
          // Сообщаем native — не оставлять FGS висеть впустую.
          await bgChannel.invokeMethod('stopSelf', {'reason': 'init_failed'});
        }
        return null;
      case 'forceStop':
        diagLog('sound_around', 'forceStop from native');
        await controller.stop(reason: 'native_force_stop');
        return null;
      case 'applyAnswer':
        try {
          final args = (call.arguments as Map).cast<String, dynamic>();
          final sdp = args['sdp'] as String;
          diagLog('sound_around', 'applyAnswer received len=${sdp.length}');
          await controller.applyAnswer(sdp);
        } catch (e, st) {
          diagLog('sound_around', 'applyAnswer failed: $e\n$st');
        }
        return null;
      default:
        throw MissingPluginException('Unknown method: ${call.method}');
    }
  });
}
