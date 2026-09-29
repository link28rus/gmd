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
    String? networkType,
    String? mobileOperator,
    bool? isMock,
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
            networkType: Value(networkType),
            mobileOperator: Value(mobileOperator),
            isMock: Value(isMock),
            recordedAt: recordedAt,
          ),
        );
  }

  /// Самые старые точки очереди. Счётчик попыток не учитывается: до v0.59.0
  /// точка после 5 неудачных отправок навсегда выпадала из выборки, и за
  /// минуту без сети терялся весь трек (поездка рисовалась прямой).
  Future<List<PendingLocation>> takeBatch({int limit = 500}) {
    return (_db.select(_db.pendingLocations)
          ..orderBy([(t) => OrderingTerm.asc(t.recordedAt), (t) => OrderingTerm.asc(t.id)])
          ..limit(limit))
        .get();
  }

  Future<void> deleteIds(List<int> ids) async {
    if (ids.isEmpty) return;
    await (_db.delete(_db.pendingLocations)..where((t) => t.id.isIn(ids))).go();
  }

  /// Удалить точки старше [cutoff] — сервер их уже не примет (окно 7 суток).
  Future<int> deleteOlderThan(DateTime cutoff) {
    return (_db.delete(_db.pendingLocations)
          ..where((t) => t.recordedAt.isSmallerThanValue(cutoff)))
        .go();
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
