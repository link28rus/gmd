import 'dart:ui' show DartPluginRegistrant;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../core/api/child_api.dart';
import '../core/api/dio_client.dart';
import '../core/config/env.dart';
import '../core/diag/diag_channel.dart';
import '../core/native/signal_channel.dart';
import '../core/storage/secure_storage_service.dart';
import '../data/database.dart';
import '../data/location_queue_repository.dart';
import '../features/sound_around/audio_command_handler.dart';
import '../ingestor/location_ingestor.dart';

// Headless Dart entrypoint для фонового изолята, запускаемого из
// LocationForegroundService. Живёт пока жив service (переживает закрытие UI,
// screen off, ребут — когда service перезапускает BootReceiver).
// Все локации, прилетающие из Kotlin через MethodChannel, уходят в очередь
// Drift и отправляются в API из этого же изолята. UI-изолят к БД не ходит,
// чтобы избежать конкуренции двух Flutter engine за одну sqlite.
@pragma('vm:entry-point')
void locationEntryPoint() {
  WidgetsFlutterBinding.ensureInitialized();
  // Обязательно для headless-изолятов в Flutter 3.x — регистрирует Dart-side
  // плагинов, без этого MethodChannel handler'ы не доходят до native.
  DartPluginRegistrant.ensureInitialized();
  diagLog('bg', 'locationEntryPoint: starting headless isolate');

  _bootstrap();
}

Future<void> _bootstrap() async {
  try {
    diagLog('bg', 'bootstrap: opening AppDatabase');
    final db = AppDatabase();
    final repo = LocationQueueRepository(db);
    diagLog('bg', 'bootstrap: building ChildApi base=$apiBaseUrl');
    final api = ChildApi(buildDio(baseUrl: apiBaseUrl));
    final storage = SecureStorageService();
    final signalChannel = SignalChannel();
    final audioHandler = AudioCommandHandler();
    final ingestor = LocationIngestor(
      repo: repo,
      api: api,
      deviceToken: storage.readDeviceToken,
      onUnauthorized: () async {
        // Device revoked на сервере — чистим токен (следующий старт UI уйдёт
        // на /onboarding) и сами останавливаем сервис: UI может не открыться
        // никогда, а без этого GPS, wakelock и realtime жили бы до повторной
        // привязки, копя точки, которые некуда отправить.
        diagLog('bg', 'ingestor: UNAUTHORIZED → clearing token, stopping service');
        await storage.clearAll();
        try {
          await const MethodChannel('pro.periscop.child/location').invokeMethod('deviceUnlinked');
        } catch (e) {
          diagLog('bg', 'deviceUnlinked failed: $e');
        }
      },
      onCommand: (cmd) async {
        diagLog('bg', 'command received: ${cmd.type} id=${cmd.id}');
        if (cmd.type == 'PLAY_SIGNAL') {
          await signalChannel.play();
          return; // ack
        }
        // v0.60.0: запрос журнала админом. Native ставит отправку в
        // WorkManager (commandId уйдёт вместе с журналом); не поставилась —
        // без ack, сервер отдаст команду в следующем poll'е.
        if (cmd.type == 'UPLOAD_DIAG') {
          final queued = await diagUpload(reason: 'manual', commandId: cmd.id);
          if (!queued) {
            throw Exception('UPLOAD_DIAG enqueue failed — skip ack for retry');
          }
          return; // ack
        }
        final handled = await audioHandler.handle(cmd);
        if (!handled) {
          // Неизвестный тип — ack, чтобы сервер не гонял команду бесконечно.
          diagLog('bg', 'unknown command type ${cmd.type} — acked to drop');
        }
        // handled=false для START_AUDIO-failure: handler уже вернул false,
        // но onCommand возвращает void — бросим исключение чтобы ingestor
        // пропустил ack и сервер переотдал команду при следующем poll.
        if (cmd.type == 'START_AUDIO' && !handled) {
          throw Exception('START_AUDIO failed — skip ack for retry');
        }
      },
    );
    diagLog('bg', 'bootstrap: ingestor ready');

    const channel = MethodChannel('pro.periscop.child/location');
    channel.setMethodCallHandler((call) async {
      if (call.method == 'onLocation' && call.arguments is Map) {
        try {
          await ingestor.onLocation(Map<String, dynamic>.from(call.arguments as Map));
          diagLog('bg', 'onLocation OK');
        } catch (e, st) {
          diagLog('bg', 'onLocation FAILED: $e');
          diagLog('bg', st.toString().split('\n').take(3).join(' | '));
        }
      }
    });

    Connectivity().onConnectivityChanged.listen((list) {
      if (list.any((r) => r != ConnectivityResult.none)) {
        diagLog('bg', 'connectivity changed → flushQueue');
        ingestor.onConnectivityRestored();
      }
    });
  } catch (e, st) {
    diagLog('bg', 'bootstrap FAILED: $e');
    diagLog('bg', st.toString().split('\n').take(5).join(' | '));
  }
}
