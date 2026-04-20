import 'package:drift/drift.dart';
import 'database.dart';

class LocationQueueRepository {
  LocationQueueRepository(this._db);
  final AppDatabase _db;

  Future<int> enqueue({
    required double lat,
    required double lon,
    double? accuracy,
    double? altitude,
    double? speed,
    double? bearing,
    int? batteryLevel,
    bool? isCharging,
    String? provider,
    required DateTime recordedAt,
  }) async {
    return _db.into(_db.pendingLocations).insert(
          PendingLocationsCompanion.insert(
            lat: lat,
            lon: lon,
            accuracy: Value(accuracy),
            altitude: Value(altitude),
            speed: Value(speed),
            bearing: Value(bearing),
            batteryLevel: Value(batteryLevel),
            isCharging: Value(isCharging),
            provider: Value(provider),
            recordedAt: recordedAt,
          ),
        );
  }

  Future<List<PendingLocation>> takeBatch({int limit = 100, int maxAttempts = 5}) {
    return (_db.select(_db.pendingLocations)
          ..where((t) => t.uploadAttempts.isSmallerThanValue(maxAttempts))
          ..orderBy([(t) => OrderingTerm.asc(t.recordedAt)])
          ..limit(limit))
        .get();
  }

  Future<void> deleteIds(List<int> ids) async {
    if (ids.isEmpty) return;
    await (_db.delete(_db.pendingLocations)..where((t) => t.id.isIn(ids))).go();
  }

  Future<void> markRetry(List<int> ids) async {
    if (ids.isEmpty) return;
    final placeholders = List.filled(ids.length, '?').join(',');
    await _db.customStatement(
      'UPDATE pending_locations '
      'SET upload_attempts = upload_attempts + 1, last_attempt_at = ? '
      'WHERE id IN ($placeholders)',
      [DateTime.now().millisecondsSinceEpoch ~/ 1000, ...ids],
    );
  }

  Future<int> count() async {
    final c = _db.pendingLocations.id.count();
    final row = await (_db.selectOnly(_db.pendingLocations)..addColumns([c])).getSingle();
    return row.read(c) ?? 0;
  }

  Future<void> trimOverflow({int maxSize = 10000}) async {
    final total = await count();
    if (total <= maxSize) return;
    final toDrop = total - maxSize;
    final oldest = await (_db.select(_db.pendingLocations)
          ..orderBy([(t) => OrderingTerm.asc(t.recordedAt)])
          ..limit(toDrop))
        .map((r) => r.id)
        .get();
    await deleteIds(oldest);
  }
}
