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

  test('markRetry increments attempts', () async {
    final id = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    await repo.markRetry([id]);
    await repo.markRetry([id]);
    final rows = await repo.takeBatch(limit: 1);
    expect(rows.first.uploadAttempts, 2);
  });

  test('takeBatch excludes exhausted rows', () async {
    final id = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    for (var i = 0; i < 5; i++) {
      await repo.markRetry([id]);
    }
    final rows = await repo.takeBatch(limit: 10);
    expect(rows, isEmpty);
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
