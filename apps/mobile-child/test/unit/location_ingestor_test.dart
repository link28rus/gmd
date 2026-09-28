import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/core/api/api_exceptions.dart';
import 'package:periscop_child/core/api/child_api.dart';
import 'package:periscop_child/data/database.dart';
import 'package:periscop_child/data/location_queue_repository.dart';
import 'package:periscop_child/ingestor/location_ingestor.dart';
import 'package:mocktail/mocktail.dart';

class _MockApi extends Mock implements ChildApi {}

void main() {
  late AppDatabase db;
  late LocationQueueRepository repo;
  late _MockApi api;
  late LocationIngestor ingestor;
  late DateTime now;
  // Каждая пачка, дошедшая до api.ingestLocations, — список lat её точек.
  late List<List<double>> sent;

  setUpAll(() {
    registerFallbackValue(<LocationPoint>[]);
  });

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = LocationQueueRepository(db);
    api = _MockApi();
    now = DateTime(2026, 9, 28, 8);
    sent = [];
    ingestor = LocationIngestor(
      repo: repo,
      api: api,
      deviceToken: () async => 'tok',
      clock: () => now,
    );
  });

  tearDown(() => db.close());

  List<double> latsOf(Invocation inv) =>
      (inv.positionalArguments[0] as List<LocationPoint>).map((p) => p.lat).toList();

  void apiAccepts() {
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenAnswer((inv) async {
      sent.add(latsOf(inv));
      return IngestResponse(acceptedIds: const [], rejectedIds: const []);
    });
  }

  void apiOffline() {
    when(() => api.ingestLocations(any(), deviceToken: 'tok'))
        .thenThrow(const NetworkException('offline'));
  }

  Map<String, dynamic> point(double lat, {int secondsFromStart = 0}) => {
        'lat': lat,
        'lon': 37.0,
        'accuracy': 10.0,
        'provider': 'fused',
        'recordedAt': DateTime(2026, 9, 28, 7)
            .add(Duration(seconds: secondsFromStart))
            .millisecondsSinceEpoch,
      };

  Future<void> enqueue(int n) async {
    for (var i = 0; i < n; i++) {
      await repo.enqueue(
        lat: i.toDouble(),
        lon: 37,
        recordedAt: DateTime(2026, 9, 28, 7).add(Duration(seconds: i)),
      );
    }
  }

  test('onLocation enqueues to repo', () async {
    apiOffline();
    await ingestor.onLocation(point(55.7558));
    final left = await repo.takeBatch(limit: 10);
    expect(left.length, 1);
  });

  test('flushQueue deletes points on success', () async {
    apiAccepts();
    await enqueue(2);
    await ingestor.flushQueue();
    expect(sent, [
      [0, 1],
    ]);
    expect(await repo.count(), 0);
  });

  test('offline: points survive any number of failures and go out when network returns',
      () async {
    apiOffline();
    // 30 минут без сети, точка каждые 5 секунд — 360 точек.
    for (var i = 0; i < 360; i++) {
      now = now.add(const Duration(seconds: 5));
      await ingestor.onLocation(point(i.toDouble(), secondsFromStart: i * 5));
    }
    expect(await repo.count(), 360);

    apiAccepts();
    await ingestor.onConnectivityRestored();
    expect(await repo.count(), 0);
    expect(sent.expand((b) => b).toList(), List.generate(360, (i) => i.toDouble()));
  });

  test('offline: backoff stops hitting the network on every new point', () async {
    apiOffline();
    await ingestor.onLocation(point(1)); // первая точка → попытка, сбой
    verify(() => api.ingestLocations(any(), deviceToken: 'tok')).called(1);

    // 10 секунд — внутри паузы 15 с, в сеть не ходим.
    for (var i = 0; i < 2; i++) {
      now = now.add(const Duration(seconds: 5));
      await ingestor.onLocation(point(2.0 + i, secondsFromStart: 5 + i * 5));
    }
    verifyNever(() => api.ingestLocations(any(), deviceToken: 'tok'));

    // Пауза 15 с истекла → одна попытка, следующая пауза 30 с.
    now = now.add(const Duration(seconds: 6));
    await ingestor.onLocation(point(4, secondsFromStart: 16));
    verify(() => api.ingestLocations(any(), deviceToken: 'tok')).called(1);
    now = now.add(const Duration(seconds: 20));
    await ingestor.onLocation(point(5, secondsFromStart: 36));
    verifyNever(() => api.ingestLocations(any(), deviceToken: 'tok'));
  });

  test('429 keeps points in queue', () async {
    await enqueue(3);
    when(() => api.ingestLocations(any(), deviceToken: 'tok'))
        .thenThrow(const TooManyRequestsException());
    await ingestor.flushQueue();
    expect(await repo.count(), 3);
  });

  test('400: bisects the batch and drops only the bad point', () async {
    await enqueue(8);
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenAnswer((inv) async {
      final lats = latsOf(inv);
      if (lats.contains(5.0)) throw const BadRequestIngestException();
      sent.add(lats);
      return IngestResponse(acceptedIds: const [], rejectedIds: const []);
    });
    await ingestor.flushQueue();
    expect(await repo.count(), 0);
    expect(sent.expand((b) => b).toList(), [0, 1, 2, 3, 4, 6, 7]);
  });

  test('413: shrinks the batch without losing points', () async {
    await enqueue(10);
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenAnswer((inv) async {
      final lats = latsOf(inv);
      if (lats.length > 4) throw const BatchTooLargeException();
      sent.add(lats);
      return IngestResponse(acceptedIds: const [], rejectedIds: const []);
    });
    await ingestor.flushQueue();
    expect(await repo.count(), 0);
    expect(sent.expand((b) => b).toList(), List.generate(10, (i) => i.toDouble()));
    expect(sent.every((b) => b.length <= 4), isTrue);
  });

  test('drains a big backlog in batches, oldest first', () async {
    apiAccepts();
    await enqueue(1200);
    await ingestor.flushQueue();
    expect(sent.map((b) => b.length).toList(), [500, 500, 200]);
    expect(sent.first.first, 0);
    expect(await repo.count(), 0);
  });

  test('pass limit: pauses after maxBatchesPerFlush batches, rest goes later', () async {
    apiAccepts();
    const perPass = LocationIngestor.maxBatchesPerFlush * LocationIngestor.maxBatchSize;
    await enqueue(perPass + 10);
    await ingestor.flushQueue();
    expect(await repo.count(), 10);
    await ingestor.flushQueue(); // внутри паузы — ничего
    expect(await repo.count(), 10);
    now = now.add(LocationIngestor.drainCooldown);
    await ingestor.flushQueue();
    expect(await repo.count(), 0);
  });

  test('only one flush runs at a time', () async {
    await enqueue(3);
    final gate = Completer<void>();
    var calls = 0;
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenAnswer((_) async {
      calls++;
      await gate.future;
      return IngestResponse(acceptedIds: const [], rejectedIds: const []);
    });
    final first = ingestor.flushQueue();
    await ingestor.flushQueue();
    gate.complete();
    await first;
    expect(calls, 1);
    expect(await repo.count(), 0);
  });

  test('401 clears the queue and reports unauthorized', () async {
    var revoked = false;
    ingestor = LocationIngestor(
      repo: repo,
      api: api,
      deviceToken: () async => 'tok',
      onUnauthorized: () async => revoked = true,
      clock: () => now,
    );
    await enqueue(2);
    when(() => api.ingestLocations(any(), deviceToken: 'tok'))
        .thenThrow(const UnauthorizedException());
    await ingestor.flushQueue();
    expect(revoked, isTrue);
    expect(await repo.count(), 0);
  });

  test('toJson drops values the server would reject', () {
    final p = LocationPoint(
      lat: 1,
      lon: 2,
      recordedAt: DateTime.utc(2026, 9, 28),
      accuracy: -1,
      altitude: double.nan,
      speed: double.infinity,
      bearing: 360,
    );
    final json = p.toJson();
    expect(json.containsKey('accuracy'), isFalse);
    expect(json.containsKey('altitude'), isFalse);
    expect(json.containsKey('speed'), isFalse);
    expect(json['bearing'], 0);
  });
}
