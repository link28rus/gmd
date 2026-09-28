import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/data/database.dart';
import 'package:periscop_child/data/location_queue_repository.dart';

void main() {
  late AppDatabase db;
  late LocationQueueRepository repo;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = LocationQueueRepository(db);
  });
  tearDown(() => db.close());

  test('enqueue + takeBatch round-trip', () async {
    for (var i = 0; i < 7; i++) {
      await repo.enqueue(lat: 55.75 + i * 0.001, lon: 37.61, recordedAt: DateTime.now());
    }
    final batch = await repo.takeBatch(limit: 5);
    expect(batch.length, 5);
  });

  test('deleteAccepted removes specified rows', () async {
    final id1 = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    final id2 = await repo.enqueue(lat: 2, lon: 2, recordedAt: DateTime.now());
    await repo.deleteIds([id1]);
    final left = await repo.takeBatch(limit: 100);
    expect(left.length, 1);
    expect(left.first.id, id2);
  });

  test('takeBatch returns oldest first', () async {
    final base = DateTime(2026, 9, 28, 8);
    await repo.enqueue(lat: 3, lon: 3, recordedAt: base.add(const Duration(minutes: 2)));
    await repo.enqueue(lat: 1, lon: 1, recordedAt: base);
    await repo.enqueue(lat: 2, lon: 2, recordedAt: base.add(const Duration(minutes: 1)));
    final rows = await repo.takeBatch(limit: 10);
    expect(rows.map((r) => r.lat), [1, 2, 3]);
  });

  test('takeBatch ignores upload attempts left by old versions', () async {
    // До v0.59.0 точка после 5 неудач выпадала из выборки навсегда.
    final id = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    await db.customStatement(
      'UPDATE pending_locations SET upload_attempts = 5 WHERE id = ?',
      [id],
    );
    final rows = await repo.takeBatch(limit: 10);
    expect(rows.map((r) => r.id), [id]);
  });

  test('deleteOlderThan drops only expired points', () async {
    final now = DateTime(2026, 9, 28, 8);
    await repo.enqueue(lat: 1, lon: 1, recordedAt: now.subtract(const Duration(days: 8)));
    await repo.enqueue(lat: 2, lon: 2, recordedAt: now.subtract(const Duration(days: 6)));
    final dropped = await repo.deleteOlderThan(now.subtract(const Duration(days: 7)));
    expect(dropped, 1);
    final rows = await repo.takeBatch(limit: 10);
    expect(rows.map((r) => r.lat), [2]);
  });

  test('trimOverflow drops oldest beyond cap', () async {
    for (var i = 0; i < 12; i++) {
      await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    }
    await repo.trimOverflow(maxSize: 10);
    final all = await repo.takeBatch(limit: 100);
    expect(all.length, 10);
  });
}
