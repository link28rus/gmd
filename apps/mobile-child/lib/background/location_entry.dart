import 'dart:developer' as developer;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../core/api/child_api.dart';
import '../core/api/dio_client.dart';
import '../core/config/env.dart';
import '../core/storage/secure_storage_service.dart';
import '../data/database.dart';
import '../data/location_queue_repository.dart';
import '../ingestor/location_ingestor.dart';

void _log(String msg, [Object? err, StackTrace? stack]) {
  developer.log(msg, name: 'gmd.bg', error: err, stackTrace: stack);
}

// Headless Dart entrypoint для фонового изолята, запускаемого из
// LocationForegroundService. Живёт пока жив service (переживает закрытие UI,
// screen off, ребут — когда service перезапускает BootReceiver).
// Все локации, прилетающие из Kotlin через MethodChannel, уходят в очередь
// Drift и отправляются в API из этого же изолята. UI-изолят к БД не ходит,
// чтобы избежать конкуренции двух Flutter engine за одну sqlite.
@pragma('vm:entry-point')
void locationEntryPoint() {
  WidgetsFlutterBinding.ensureInitialized();
  _log('locationEntryPoint: starting headless isolate');

  try {
    final db = AppDatabase();
    final repo = LocationQueueRepository(db);
    final api = ChildApi(buildDio(baseUrl: apiBaseUrl));
    final storage = SecureStorageService();
    final ingestor = LocationIngestor(
      repo: repo,
      api: api,
      deviceToken: storage.readDeviceToken,
    );
    _log('locationEntryPoint: ingestor ready');

    const channel = MethodChannel('ru.link28rus.gmd.child/location');
    channel.setMethodCallHandler((call) async {
      if (call.method == 'onLocation' && call.arguments is Map) {
        try {
          await ingestor.onLocation(Map<String, dynamic>.from(call.arguments as Map));
        } catch (e, st) {
          _log('onLocation failed', e, st);
        }
      }
    });

    Connectivity().onConnectivityChanged.listen((list) {
      if (list.any((r) => r != ConnectivityResult.none)) {
        ingestor.flushQueue();
      }
    });
  } catch (e, st) {
    _log('locationEntryPoint init failed', e, st);
  }
}
