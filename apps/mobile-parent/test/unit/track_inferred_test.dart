import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/children/child_models.dart';
import 'package:periscop_parent/features/children/track_gaps.dart';
import 'package:periscop_parent/features/children/track_view_provider.dart';
import 'package:periscop_parent/features/children/widgets/track_layers.dart';
import 'package:shared_preferences/shared_preferences.dart';

// v0.80.0: достроенные по дороге участки трека (точки `inferred`).
// 0.001° широты ≈ 111 м (R = 6 371 000 м).
const _lat0 = 55.75;
const _lon0 = 37.62;
final _t0 = DateTime.utc(2026, 10, 9, 7, 0);

ChildLocation _p(double dLatDeg, Duration dt, {bool inferred = false}) =>
    ChildLocation(
      lat: _lat0 + dLatDeg,
      lon: _lon0,
      recordedAt: _t0.add(dt),
      inferred: inferred,
    );

Duration _s(int s) => Duration(seconds: s);
Duration _m(int m) => Duration(minutes: m);

void main() {
  group('ChildLocation.fromJson inferred', () {
    Map<String, dynamic> json([Object? inferred]) => {
          'lat': _lat0,
          'lon': _lon0,
          'recordedAt': '2026-10-09T07:00:00.000Z',
          'inferred': ?inferred,
        };

    test('inferred: true — достроенная', () {
      expect(ChildLocation.fromJson(json(true)).inferred, isTrue);
    });

    test('нет поля / false / не bool — реальная', () {
      expect(ChildLocation.fromJson(json()).inferred, isFalse);
      expect(ChildLocation.fromJson(json(false)).inferred, isFalse);
      expect(ChildLocation.fromJson(json('true')).inferred, isFalse);
    });
  });

  group('splitTrackForMap', () {
    test('пустой список и одна точка — пусто', () {
      for (final pts in [<ChildLocation>[], [_p(0, Duration.zero)]]) {
        final split = splitTrackForMap(pts);
        expect(split.segments, isEmpty);
        expect(split.gaps, isEmpty);
        expect(split.inferred, isEmpty);
      }
    });

    test('без достройки — как splitTrackByGaps', () {
      final a = _p(0, Duration.zero);
      final b = _p(0.001, _s(30));
      final c = _p(0.019, _s(30) + _m(67)); // ≈2 км от b
      final d = _p(0.0195, _s(60) + _m(67));
      final split = splitTrackForMap([a, b, c, d]);
      expect(split.inferred, isEmpty);
      expect(split.segments, [
        [a, b],
        [c, d],
      ]);
      expect(split.gaps, hasLength(1));
      expect(split.gaps.single.from, same(b));
      expect(split.gaps.single.to, same(c));
    });

    test('разрыв достроен — пунктирная серия, не разрыв', () {
      final a = _p(0, Duration.zero);
      final b = _p(0.001, _s(30));
      // Достроенные точки идут плотно по времени: обычная детекция разрыва
      // на них не сработала бы.
      final x1 = _p(0.006, _s(30) + _m(20), inferred: true);
      final x2 = _p(0.012, _s(30) + _m(40), inferred: true);
      final c = _p(0.019, _s(30) + _m(67));
      final d = _p(0.0195, _s(60) + _m(67));
      final split = splitTrackForMap([d, x2, a, c, x1, b]); // порядок любой
      expect(split.gaps, isEmpty);
      expect(split.segments, [
        [a, b],
        [c, d],
      ]);
      expect(split.inferred, hasLength(1));
      final run = split.inferred.single;
      expect(run.points, [b, x1, x2, c]);
      expect(run.from, same(b));
      expect(run.to, same(c));
      expect(run.duration, _m(67));
    });

    test('отрезок достроен, если inferred хотя бы один конец', () {
      final a = _p(0, Duration.zero);
      final x = _p(0.001, _s(30), inferred: true);
      final b = _p(0.002, _s(60));
      final split = splitTrackForMap([a, x, b]);
      expect(split.segments, isEmpty);
      expect(split.inferred.single.points, [a, x, b]);
      expect(split.inferred.single.duration, _s(60));
    });

    test('реальная точка внутри — две серии со своими длительностями', () {
      final a = _p(0, Duration.zero);
      final x = _p(0.005, _m(10), inferred: true);
      final b = _p(0.010, _m(20));
      final y = _p(0.015, _m(35), inferred: true);
      final c = _p(0.020, _m(50));
      final split = splitTrackForMap([a, x, b, y, c]);
      expect(split.segments, isEmpty);
      expect(split.inferred.map((r) => r.points).toList(), [
        [a, x, b],
        [b, y, c],
      ]);
      expect(split.inferred.map((r) => r.duration).toList(), [_m(20), _m(30)]);
    });

    test('трек начат или кончен достройкой — серия без длительности', () {
      final x0 = _p(0, Duration.zero, inferred: true);
      final a = _p(0.001, _s(30));
      final b = _p(0.002, _s(60));
      final y = _p(0.003, _s(90), inferred: true);
      final split = splitTrackForMap([x0, a, b, y]);
      expect(split.segments, [
        [a, b],
      ]);
      expect(split.inferred, hasLength(2));
      expect(split.inferred[0].from, isNull);
      expect(split.inferred[0].to, same(a));
      expect(split.inferred[0].duration, isNull);
      expect(split.inferred[1].from, same(b));
      expect(split.inferred[1].to, isNull);
      expect(split.inferred[1].duration, isNull);
    });
  });

  group('trackPolylineMidpoint', () {
    test('пусто — null, одна точка — она', () {
      expect(trackPolylineMidpoint(const []), isNull);
      final m = trackPolylineMidpoint([_p(0.001, Duration.zero)])!;
      expect(m.lat, closeTo(_lat0 + 0.001, 1e-9));
    });

    test('середина по длине, а не по числу точек', () {
      // 0 → 0.001 → 0.010: середина длины на 0.005, внутри второго отрезка.
      final m = trackPolylineMidpoint([
        _p(0, Duration.zero),
        _p(0.001, _s(30)),
        _p(0.010, _s(60)),
      ])!;
      expect(m.lat, closeTo(_lat0 + 0.005, 1e-6));
      expect(m.lon, closeTo(_lon0, 1e-9));
    });
  });

  group('buildTrackLayers с достройкой', () {
    test('достроенная серия — зелёный пунктир с подписью «нет данных»', () {
      final layers = buildTrackLayers([
        _p(0, Duration.zero),
        _p(0.001, _s(30)),
        _p(0.006, _s(30) + _m(20), inferred: true),
        _p(0.012, _s(30) + _m(40), inferred: true),
        _p(0.019, _s(30) + _m(67)),
        _p(0.0195, _s(60) + _m(67)),
      ]);
      final polylines = layers.whereType<PolylineLayer>().single.polylines;
      final dashed = polylines.where((p) => p.pattern != const StrokePattern.solid());
      expect(dashed, hasLength(1));
      expect(dashed.single.color, const Color(0xFF2E7D32));
      expect(dashed.single.points, hasLength(4));
      expect(polylines, hasLength(3)); // два сплошных куска + пунктир
      final labels = layers.whereType<MarkerLayer>().single.markers;
      expect(labels, hasLength(1));
      // Подпись — у середины серии по длине (0.001 → 0.019 ⇒ 0.010).
      expect(labels.single.point.latitude, closeTo(_lat0 + 0.010, 1e-6));
    });

    test('серия короче минуты — без подписи', () {
      final layers = buildTrackLayers([
        _p(0, Duration.zero),
        _p(0.001, _s(20), inferred: true),
        _p(0.002, _s(40)),
      ]);
      expect(layers.whereType<MarkerLayer>(), isEmpty);
    });
  });

  group('trackViewProvider', () {
    test('по умолчанию — по дорогам', () async {
      SharedPreferences.setMockInitialValues({});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(await c.read(trackViewProvider.future), TrackView.road);
    });

    test('сохранённое «как записано» читается и меняется', () async {
      SharedPreferences.setMockInitialValues({kTrackViewPrefsKey: 'recorded'});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(await c.read(trackViewProvider.future), TrackView.recorded);
      await c.read(trackViewProvider.notifier).setView(TrackView.road);
      expect(c.read(trackViewProvider).value, TrackView.road);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(kTrackViewPrefsKey), 'road');
    });
  });
}
