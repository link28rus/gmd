import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/data/database.dart';

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('insert + select pending location', () async {
    await db.into(db.pendingLocations).insert(PendingLocationsCompanion.insert(
          lat: 55.7558,
          lon: 37.6173,
          recordedAt: DateTime.now(),
        ));
    final rows = await db.select(db.pendingLocations).get();
    expect(rows.length, 1);
    expect(rows.first.lat, closeTo(55.7558, 0.0001));
  });

  test('app settings upsert', () async {
    await db.into(db.appSettings).insertOnConflictUpdate(
          AppSettingsCompanion.insert(key: 'childId', value: 'c1'),
        );
    await db.into(db.appSettings).insertOnConflictUpdate(
          AppSettingsCompanion.insert(key: 'childId', value: 'c2'),
        );
    final row = await (db.select(db.appSettings)
          ..where((t) => t.key.equals('childId')))
        .getSingle();
    expect(row.value, 'c2');
  });
}
