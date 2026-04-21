import '../core/api/api_exceptions.dart';
import '../core/api/child_api.dart';
import '../data/location_queue_repository.dart';

class LocationIngestor {
  LocationIngestor({
    required this.repo,
    required this.api,
    required this.deviceToken,
  });
  final LocationQueueRepository repo;
  final ChildApi api;
  final Future<String?> Function() deviceToken;

  DateTime _lastFlush = DateTime.fromMillisecondsSinceEpoch(0);
  bool _firstFlushed = false;

  Future<void> onLocation(Map<String, dynamic> payload) async {
    await repo.enqueue(
      lat: (payload['lat'] as num).toDouble(),
      lon: (payload['lon'] as num).toDouble(),
      accuracy: (payload['accuracy'] as num?)?.toDouble(),
      altitude: (payload['altitude'] as num?)?.toDouble(),
      speed: (payload['speed'] as num?)?.toDouble(),
      bearing: (payload['bearing'] as num?)?.toDouble(),
      batteryLevel: payload['batteryLevel'] as int?,
      isCharging: payload['isCharging'] as bool?,
      provider: payload['provider'] as String?,
      networkType: payload['networkType'] as String?,
      recordedAt: DateTime.fromMillisecondsSinceEpoch(
        (payload['recordedAt'] as num).toInt(),
      ),
    );
    await repo.trimOverflow(maxSize: 10000);
    final count = await repo.count();
    final age = DateTime.now().difference(_lastFlush);
    // Первую локацию флашим сразу. Дальше — near-realtime: батчим по 2
    // точки или раз в 20с, чтобы родитель видел движение почти вживую
    // без перегрева rate-limit.
    if (!_firstFlushed || count >= 2 || age > const Duration(seconds: 20)) {
      _firstFlushed = true;
      await flushQueue();
    }
  }

  Future<void> flushQueue() async {
    _lastFlush = DateTime.now();
    final token = await deviceToken();
    if (token == null) return;
    final batch = await repo.takeBatch(limit: 100);
    if (batch.isEmpty) return;
    try {
      await api.ingestLocations(
        batch
            .map((r) => LocationPoint(
                  lat: r.lat,
                  lon: r.lon,
                  accuracy: r.accuracy,
                  altitude: r.altitude,
                  speed: r.speed,
                  bearing: r.bearing,
                  batteryLevel: r.batteryLevel,
                  isCharging: r.isCharging,
                  provider: r.provider,
                  networkType: r.networkType,
                  recordedAt: r.recordedAt,
                ))
            .toList(),
        deviceToken: token,
      );
      await repo.deleteIds(batch.map((r) => r.id).toList());
    } on BadRequestIngestException {
      await repo.deleteIds(batch.map((r) => r.id).toList());
    } catch (_) {
      await repo.markRetry(batch.map((r) => r.id).toList());
    }
  }
}
