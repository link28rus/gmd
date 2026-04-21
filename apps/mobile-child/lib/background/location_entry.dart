import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../core/api/child_api.dart';
import '../core/api/dio_client.dart';
import '../core/config/env.dart';
import '../core/diag/diag_channel.dart';
import '../core/storage/secure_storage_service.dart';
import '../data/database.dart';
import '../data/location_queue_repository.dart';
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
    final ingestor = LocationIngestor(
      repo: repo,
      api: api,
      deviceToken: storage.readDeviceToken,
    );
    diagLog('bg', 'bootstrap: ingestor ready');

    const channel = MethodChannel('ru.link28rus.gmd.child/location');
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
        ingestor.flushQueue();
      }
    });
  } catch (e, st) {
    diagLog('bg', 'bootstrap FAILED: $e');
    diagLog('bg', st.toString().split('\n').take(5).join(' | '));
  }
}
