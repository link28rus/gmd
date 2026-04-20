import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/native/location_service_channel.dart';
import '../../data/database.dart';
import '../../data/location_queue_repository.dart';
import '../../features/claim/claim_controller.dart';
import '../../ingestor/location_ingestor.dart';

final appDatabaseProvider = Provider<AppDatabase>((_) => AppDatabase());
final locationRepoProvider = Provider<LocationQueueRepository>(
  (ref) => LocationQueueRepository(ref.watch(appDatabaseProvider)),
);
final ingestorProvider = Provider<LocationIngestor>((ref) {
  return LocationIngestor(
    repo: ref.watch(locationRepoProvider),
    api: ref.watch(childApiProvider),
    deviceToken: () => ref.watch(secureStorageProvider).readDeviceToken(),
  );
});
final serviceChannelProvider = Provider<LocationServiceChannel>((_) => LocationServiceChannel());

final homeInitProvider = FutureProvider<void>((ref) async {
  final ingestor = ref.watch(ingestorProvider);
  final ch = ref.watch(serviceChannelProvider);
  ch.onLocation(ingestor.onLocation);
  await ch.startService();

  final conn = Connectivity();
  conn.onConnectivityChanged.listen((list) {
    if (list.any((r) => r != ConnectivityResult.none)) {
      ingestor.flushQueue();
    }
  });
});
