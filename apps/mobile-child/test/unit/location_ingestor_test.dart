import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/data/database.dart';
import 'package:gmd_child/data/location_queue_repository.dart';
import 'package:gmd_child/ingestor/location_ingestor.dart';
import 'package:mocktail/mocktail.dart';

class _MockApi extends Mock implements ChildApi {}

void main() {
  late AppDatabase db;
  late LocationQueueRepository repo;
  late _MockApi api;
  late LocationIngestor ingestor;

  setUpAll(() {
    registerFallbackValue(<LocationPoint>[]);
  });

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = LocationQueueRepository(db);
    api = _MockApi();
    ingestor = LocationIngestor(
      repo: repo,
      api: api,
      deviceToken: () async => 'tok',
    );
  });

  tearDown(() => db.close());

  test('onLocation enqueues to repo', () async {
    await ingestor.onLocation({
      'lat': 55.7558,
      'lon': 37.6173,
      'accuracy': 10.0,
      'batteryLevel': 80,
      'isCharging': false,
      'provider': 'fused',
      'recordedAt': DateTime.now().millisecondsSinceEpoch,
    });
    final left = await repo.takeBatch(limit: 10);
    expect(left.length, 1);
  });

  test('flushQueue deletes accepted ids on success', () async {
    await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    await repo.enqueue(lat: 2, lon: 2, recordedAt: DateTime.now());
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenAnswer(
      (_) async => IngestResponse(acceptedIds: const [], rejectedIds: const []),
    );
    await ingestor.flushQueue();
    verify(() => api.ingestLocations(any(), deviceToken: 'tok')).called(1);
    final left = await repo.takeBatch(limit: 10);
    expect(left, isEmpty);
  });

  test('flushQueue marks retry on 5xx', () async {
    await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    when(() => api.ingestLocations(any(), deviceToken: 'tok'))
        .thenThrow(Exception('5xx'));
    await ingestor.flushQueue();
    final rows = await repo.takeBatch(limit: 10);
    expect(rows.first.uploadAttempts, 1);
  });
}
