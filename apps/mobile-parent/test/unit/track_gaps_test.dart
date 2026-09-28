import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/children/child_models.dart';
import 'package:periscop_parent/features/children/track_gaps.dart';

// 0.001° широты ≈ 111 м (R = 6 371 000 м).
const _lat0 = 55.75;
const _lon0 = 37.62;
final _t0 = DateTime.utc(2026, 9, 28, 7, 0);

ChildLocation _p(double dLatDeg, Duration dt) =>
    ChildLocation(lat: _lat0 + dLatDeg, lon: _lon0, recordedAt: _t0.add(dt));

Duration _s(int s) => Duration(seconds: s);
Duration _m(int m) => Duration(minutes: m);

void main() {
  group('splitTrackByGaps', () {
    test('пустой список — ни кусков, ни разрывов', () {
      final split = splitTrackByGaps(const []);
      expect(split.segments, isEmpty);
      expect(split.gaps, isEmpty);
    });

    test('одна точка — один кусок без разрывов', () {
      final split = splitTrackByGaps([_p(0, Duration.zero)]);
      expect(split.segments, hasLength(1));
      expect(split.segments.single, hasLength(1));
      expect(split.gaps, isEmpty);
    });

    test('движение с точкой раз в 30 с — без разрывов', () {
      final pts = [for (var i = 0; i < 10; i++) _p(i * 0.0005, _s(i * 30))];
      final split = splitTrackByGaps(pts);
      expect(split.gaps, isEmpty);
      expect(split.segments, hasLength(1));
      expect(split.segments.single, hasLength(10));
    });

    test('67 мин тишины и 2 км — разрыв', () {
      final a = _p(0, Duration.zero);
      final b = _p(0.001, _s(30));
      final c = _p(0.019, _s(30) + _m(67)); // ≈2 км от b
      final d = _p(0.0195, _s(60) + _m(67));
      final split = splitTrackByGaps([a, b, c, d]);
      expect(split.gaps, hasLength(1));
      expect(split.gaps.single.from, same(b));
      expect(split.gaps.single.to, same(c));
      expect(split.gaps.single.duration, _m(67));
      expect(split.segments, hasLength(2));
      expect(split.segments[0], [a, b]);
      expect(split.segments[1], [c, d]);
    });

    test('долго стоял на месте (>5 мин, <300 м) — не разрыв', () {
      final split = splitTrackByGaps([
        _p(0, Duration.zero),
        _p(0.002, _m(40)), // ≈222 м
      ]);
      expect(split.gaps, isEmpty);
      expect(split.segments, hasLength(1));
    });

    test('быстро далеко (<5 мин, >300 м) — не разрыв', () {
      final split = splitTrackByGaps([
        _p(0, Duration.zero),
        _p(0.02, _m(4)), // ≈2.2 км
      ]);
      expect(split.gaps, isEmpty);
      expect(split.segments, hasLength(1));
    });

    test('ровно 5 мин при большом расстоянии — не разрыв (строго больше)', () {
      final split = splitTrackByGaps([_p(0, Duration.zero), _p(0.02, _m(5))]);
      expect(split.gaps, isEmpty);
    });

    test('несколько разрывов, одиночная точка между ними', () {
      final a = _p(0, Duration.zero);
      final b = _p(0.0005, _s(30));
      final c = _p(0.01, _m(20)); // разрыв b→c
      final d = _p(0.02, _m(40)); // разрыв c→d, c — одиночная
      final e = _p(0.0205, _m(40) + _s(30));
      final f = _p(0.04, _m(120)); // разрыв e→f
      final split = splitTrackByGaps([a, b, c, d, e, f]);
      expect(split.gaps, hasLength(3));
      expect(split.segments, hasLength(4));
      expect(split.segments[0], [a, b]);
      expect(split.segments[1], [c]);
      expect(split.segments[2], [d, e]);
      expect(split.segments[3], [f]);
      expect(split.gaps.map((g) => g.duration).toList(), [
        _m(20) - _s(30),
        _m(20),
        _m(80) - _s(30),
      ]);
    });

    test('неупорядоченный вход сортируется по recordedAt', () {
      final a = _p(0, Duration.zero);
      final b = _p(0.0005, _s(30));
      final c = _p(0.02, _m(30));
      final split = splitTrackByGaps([c, a, b]);
      expect(split.segments[0], [a, b]);
      expect(split.segments[1], [c]);
      expect(split.gaps.single.from, same(b));
    });
  });

  group('haversineMeters', () {
    test('0.001° широты ≈ 111 м', () {
      final d = haversineMeters(_lat0, _lon0, _lat0 + 0.001, _lon0);
      expect(d, closeTo(111.2, 0.5));
    });
  });

  group('formatTrackGapLabel', () {
    test('меньше часа — минуты', () {
      expect(formatTrackGapLabel(_m(12)), 'нет данных 12 мин');
      expect(formatTrackGapLabel(_m(59) + _s(59)), 'нет данных 59 мин');
    });

    test('час и больше — часы и минуты', () {
      expect(formatTrackGapLabel(_m(67)), 'нет данных 1 ч 7 мин');
      expect(formatTrackGapLabel(_m(125)), 'нет данных 2 ч 5 мин');
    });

    test('ровно часы — без минут', () {
      expect(formatTrackGapLabel(_m(60)), 'нет данных 1 ч');
      expect(formatTrackGapLabel(_m(120) + _s(20)), 'нет данных 2 ч');
    });
  });
}
