import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/data/database.dart';

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

  test('isMock round-trips through pending queue', () async {
    await db.into(db.pendingLocations).insert(PendingLocationsCompanion.insert(
          lat: 1,
          lon: 2,
          recordedAt: DateTime(2026, 9, 29),
          isMock: const Value(true),
        ));
    final row = await db.select(db.pendingLocations).getSingle();
    expect(row.isMock, isTrue);
  });

  test('migration v5 -> v6 adds is_mock and keeps queued points', () async {
    await db.close();
    // Схема pending_locations на schemaVersion 5 (до колонки is_mock).
    db = AppDatabase.forTesting(NativeDatabase.memory(setup: (raw) {
      raw.execute('''
        CREATE TABLE pending_locations (
          id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL, lon REAL NOT NULL,
          accuracy REAL NULL, altitude REAL NULL, speed REAL NULL, bearing REAL NULL,
          battery_level INTEGER NULL,
          is_charging INTEGER NULL CHECK (is_charging IN (0, 1)),
          provider TEXT NULL, network_type TEXT NULL, mobile_operator TEXT NULL,
          recorded_at INTEGER NOT NULL,
          upload_attempts INTEGER NOT NULL DEFAULT 0,
          last_attempt_at INTEGER NULL
        )''');
      raw.execute('CREATE TABLE app_settings (key TEXT NOT NULL, value TEXT NOT NULL, '
          'PRIMARY KEY (key))');
      raw.execute('CREATE TABLE audit_logs (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, '
          'event TEXT NOT NULL, details TEXT NULL, at INTEGER NOT NULL)');
      raw.execute('INSERT INTO pending_locations (lat, lon, recorded_at) '
          'VALUES (55.75, 37.61, 1790000000)');
      raw.userVersion = 5;
    }));

    final rows = await db.select(db.pendingLocations).get();
    expect(rows.length, 1);
    expect(rows.first.lat, closeTo(55.75, 0.0001));
    expect(rows.first.isMock, isNull);

    await db.into(db.pendingLocations).insert(PendingLocationsCompanion.insert(
          lat: 1,
          lon: 2,
          recordedAt: DateTime(2026, 9, 29),
          isMock: const Value(true),
        ));
    final mocked = await (db.select(db.pendingLocations)..where((t) => t.isMock.equals(true)))
        .get();
    expect(mocked.length, 1);
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
