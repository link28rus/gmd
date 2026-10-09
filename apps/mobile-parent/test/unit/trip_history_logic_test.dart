import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/children/child_models.dart';
import 'package:periscop_parent/features/trip_history/trip_history_logic.dart';
import 'package:periscop_parent/features/zones/zone_models.dart';

Trip _trip(String id, DateTime start, DateTime? end, {int distanceM = 1000}) => Trip(
      id: id,
      startedAt: start,
      endedAt: end,
      isActive: end == null,
      pointsCount: 10,
      distanceM: distanceM,
      startLat: 50,
      startLon: 127,
      endLat: 50.01,
      endLon: 127.01,
    );

DateTime _at(int d, int h, [int m = 0]) => DateTime(2026, 10, d, h, m);

Zone _zone(String id, double lat, double lon, int radius) => Zone(
      id: id,
      name: id,
      color: '#22c55e',
      icon: 'home',
      centerLat: lat,
      centerLon: lon,
      radius: radius,
    );

void main() {
  group('groupTripsByDay', () {
    test('новые дни сверху, внутри дня — по времени, номера и цвета по порядку', () {
      final days = groupTripsByDay([
        _trip('b', _at(9, 12, 35), _at(9, 12, 48), distanceM: 918),
        _trip('old', _at(8, 8, 10), _at(8, 8, 24)),
        _trip('a', _at(9, 8, 13), _at(9, 8, 23), distanceM: 1300),
      ], _at(9, 20));
      expect(days.map((d) => d.key), ['2026-10-09', '2026-10-08']);
      expect(days.first.trips.map((t) => (t.trip.id, t.ordinal, t.color)), [
        ('a', 1, kTripColors[0]),
        ('b', 2, kTripColors[1]),
      ]);
      expect(days.first.distanceM, 2218);
      expect(days.first.moving, const Duration(minutes: 23));
    });

    test('поездка через полночь — в дне старта; идущая считается до «сейчас»', () {
      final days = groupTripsByDay([
        _trip('night', _at(8, 23, 50), _at(9, 0, 20)),
        _trip('live', _at(9, 10), null),
      ], _at(9, 10, 30));
      expect(days.firstWhere((d) => d.key == '2026-10-08').trips.single.trip.id, 'night');
      expect(days.firstWhere((d) => d.key == '2026-10-09').moving, const Duration(minutes: 30));
    });
  });

  test('ribbonSpan — доли суток и обрезка по полуночи', () {
    final s = ribbonSpan(_trip('x', _at(9, 6), _at(9, 12)), _at(9, 0), _at(9, 20));
    expect(s.left, closeTo(0.25, 1e-9));
    expect(s.width, closeTo(0.25, 1e-9));
    final night = ribbonSpan(_trip('n', _at(9, 23), _at(10, 1)), _at(9, 0), _at(10, 2));
    expect(night.left + night.width, closeTo(1, 1e-9));
  });

  group('подписи', () {
    test('dayTitle', () {
      final now = _at(9, 15);
      expect(dayTitle(_at(9, 0), now), (title: 'Сегодня', date: '9 октября'));
      expect(dayTitle(_at(8, 0), now).title, 'Вчера');
      expect(dayTitle(_at(5, 0), now), (title: 'Понедельник', date: '5 октября'));
      expect(dayTitle(DateTime(2025, 12, 31), now).date, '31 декабря 2025');
    });

    test('расстояние, длительность, скорость, склонение', () {
      expect(fmtDistance(918), '918 м');
      expect(fmtDistance(1300), '1,3 км');
      expect(fmtDistance(109100), '109 км');
      expect(fmtDuration(const Duration(minutes: 14)), '14 мин');
      expect(fmtDuration(const Duration(minutes: 101)), '1 ч 41 мин');
      expect(fmtDuration(const Duration(seconds: 10)), '1 мин');
      expect(avgSpeedKmh(13400, const Duration(minutes: 35)), 23);
      expect(avgSpeedKmh(10, const Duration(minutes: 1)), isNull);
      expect([1, 2, 5, 11, 21, 22].map((n) => pluralRu(n, 'п', 'пп', 'ппп')),
          ['п', 'пп', 'ппп', 'ппп', 'п', 'пп']);
    });

    test('reverseKey — тот же формат, что у веб-кабинета', () {
      expect(reverseKey(50.29071, 127.52664), '127.5266,50.2907');
    });
  });

  test('zoneAt — точка в зоне с запасом; из вложенных — меньшая', () {
    final zones = [_zone('район', 50, 127, 2000), _zone('школа', 50.001, 127, 150)];
    expect(zoneAt(zones, 50.001, 127)?.id, 'школа');
    expect(zoneAt(zones, 50.01, 127)?.id, 'район');
    expect(zoneAt(zones, 51, 127), isNull);
    expect(zoneAt([_zone('школа', 50, 127, 150)], 50.00153, 127)?.id, 'школа');
  });
}
