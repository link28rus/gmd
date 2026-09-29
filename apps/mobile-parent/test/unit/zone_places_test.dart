import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/core/api/api_exception.dart';
import 'package:periscop_parent/features/zones/zone_format.dart';
import 'package:periscop_parent/features/zones/zone_models.dart';

// Геозоны v2, этап 4: подсказки мест и статистика визитов.

PlaceSuggestionChild _kid({int days = 7, int withData = 9, int? from, int? to}) =>
    PlaceSuggestionChild(
      childId: 'c1',
      days: days,
      daysWithData: withData,
      typicalFromMin: from,
      typicalToMin: to,
    );

void main() {
  group('склонение', () {
    test('pluralRu: 1 / 2–4 / 5+ / 11–14', () {
      String w(int n) => pluralRu(n, 'ночь', 'ночи', 'ночей');
      expect(w(0), 'ночей');
      expect(w(1), 'ночь');
      expect(w(2), 'ночи');
      expect(w(4), 'ночи');
      expect(w(5), 'ночей');
      expect(w(11), 'ночей');
      expect(w(12), 'ночей');
      expect(w(14), 'ночей');
      expect(w(21), 'ночь');
      expect(w(22), 'ночи');
      expect(w(25), 'ночей');
      expect(w(111), 'ночей');
      expect(w(101), 'ночь');
    });

    test('nightsCount / daysCount / visitsCount', () {
      expect(nightsCount(1), '1 ночь');
      expect(nightsCount(3), '3 ночи');
      expect(nightsCount(7), '7 ночей');
      expect(daysCount(1), '1 день');
      expect(daysCount(3), '3 дня');
      expect(daysCount(12), '12 дней');
      expect(daysCount(21), '21 день');
      expect(visitsCount(1), '1 визит');
      expect(visitsCount(4), '4 визита');
      expect(visitsCount(13), '13 визитов');
    });
  });

  group('подсказки мест', () {
    test('заголовки', () {
      expect(placeSuggestionTitle('home'), 'Дом?');
      expect(placeSuggestionTitle('school'), 'Школа?');
      expect(placeSuggestionTitle('frequent'), 'Частое место');
      expect(placeSuggestionTitle('future_kind'), 'Частое место');
    });

    test('дом — ночи из дней с данными', () {
      expect(placeEvidenceLine('home', _kid(days: 7, withData: 9)), 'ночует здесь 7 ночей из 9');
      expect(placeEvidenceLine('home', _kid(days: 1, withData: 1)), 'ночует здесь 1 ночь из 1');
      expect(placeEvidenceLine('home', _kid(days: 3, withData: 5)), 'ночует здесь 3 ночи из 5');
    });

    test('школа — с временем и без', () {
      expect(
        placeEvidenceLine('school', _kid(days: 9, from: 490, to: 820)),
        'по будням с 08:10 до 13:40 — 9 дней',
      );
      expect(placeEvidenceLine('school', _kid(days: 2)), 'по будням — 2 дня');
      expect(placeEvidenceLine('school', _kid(days: 1, from: 480)), 'по будням с 08:00 — 1 день');
    });

    test('частое место — с временем и без', () {
      expect(
        placeEvidenceLine('frequent', _kid(days: 5, from: 900, to: 1050)),
        'бывает здесь 5 дней, обычно 15:00–17:30',
      );
      expect(placeEvidenceLine('frequent', _kid(days: 4)), 'бывает здесь 4 дня');
      expect(
        placeEvidenceLine('frequent', _kid(days: 4, to: 1050)),
        'бывает здесь 4 дня, обычно до 17:30',
      );
    });

    test('PlaceSuggestion.fromJson', () {
      final s = PlaceSuggestion.fromJson({
        'id': 'school:48.4800:135.0800',
        'kind': 'school',
        'name': 'Школа',
        'icon': 'school',
        'color': '#3b82f6',
        'centerLat': 48.48,
        'centerLon': 135.08,
        'radius': 200,
        'childIds': ['c1', 'c2'],
        'children': [
          {'childId': 'c1', 'days': 9, 'daysWithData': 12, 'typicalFromMin': 490, 'typicalToMin': 820},
          {'childId': 'c2', 'days': 3, 'daysWithData': 10, 'typicalFromMin': null, 'typicalToMin': null},
        ],
      });
      expect(s.id, 'school:48.4800:135.0800');
      expect(s.kind, 'school');
      expect(s.name, 'Школа');
      expect(s.icon, 'school');
      expect(s.color, '#3b82f6');
      expect(s.centerLat, 48.48);
      expect(s.centerLon, 135.08);
      expect(s.radius, 200);
      expect(s.childIds, ['c1', 'c2']);
      expect(s.children, hasLength(2));
      expect(s.children[0].days, 9);
      expect(s.children[0].daysWithData, 12);
      expect(s.children[0].typicalFromMin, 490);
      expect(s.children[0].typicalToMin, 820);
      expect(s.children[1].typicalFromMin, isNull);
      expect(s.children[1].typicalToMin, isNull);
    });

    test('PlaceSuggestion.fromJson — частое место без имени, пустые поля', () {
      final s = PlaceSuggestion.fromJson({'id': 'frequent:1:2', 'kind': 'frequent', 'name': ''});
      expect(s.name, '');
      expect(s.icon, 'other');
      expect(s.radius, kZoneRadiusDefault);
      expect(s.childIds, isEmpty);
      expect(s.children, isEmpty);
    });
  });

  group('статистика зоны', () {
    test('ZoneStats.fromJson — время визита в локальном поясе', () {
      final st = ZoneStats.fromJson({
        'zoneId': 'z1',
        'periodDays': 30,
        'timezone': 'Asia/Vladivostok',
        'children': [
          {
            'childId': 'c1',
            'visits': 12,
            'totalSec': 237600,
            'avgSec': 19800,
            'daysCount': 12,
            'lastVisitFrom': '2026-09-29T22:10:00.000Z',
            'lastVisitTo': '2026-09-30T03:40:00.000Z',
            'ongoing': false,
            'typicalArrivalMin': 490,
            'typicalDepartureMin': 820,
          },
          {
            'childId': 'c2',
            'visits': 0,
            'totalSec': 0,
            'avgSec': 0,
            'daysCount': 0,
            'lastVisitFrom': null,
            'lastVisitTo': null,
            'ongoing': false,
            'typicalArrivalMin': null,
            'typicalDepartureMin': null,
          },
        ],
      });
      expect(st.zoneId, 'z1');
      expect(st.periodDays, 30);
      expect(st.timezone, 'Asia/Vladivostok');
      expect(st.children, hasLength(2));
      final c = st.children.first;
      expect(c.visits, 12);
      expect(c.totalSec, 237600);
      expect(c.avgSec, 19800);
      expect(c.daysCount, 12);
      expect(c.lastVisitFrom, DateTime.utc(2026, 9, 29, 22, 10).toLocal());
      expect(c.lastVisitFrom!.isUtc, isFalse);
      expect(c.lastVisitTo, DateTime.utc(2026, 9, 30, 3, 40).toLocal());
      expect(c.typicalArrivalMin, 490);
      expect(c.typicalDepartureMin, 820);
      expect(st.children[1].lastVisitFrom, isNull);
      expect(st.children[1].typicalArrivalMin, isNull);
    });

    final now = DateTime(2026, 9, 30, 15, 0);

    test('визитов не было', () {
      const s = ZoneChildStats(childId: 'c1', visits: 0, totalSec: 0, avgSec: 0, daysCount: 0);
      expect(zoneStatsLines(s, now), ['визитов не было']);
    });

    test('полная статистика и последний визит', () {
      final s = ZoneChildStats(
        childId: 'c1',
        visits: 12,
        totalSec: 237600,
        avgSec: 19800,
        daysCount: 12,
        lastVisitFrom: DateTime(2026, 9, 29, 8, 5),
        lastVisitTo: DateTime(2026, 9, 29, 13, 40),
        typicalArrivalMin: 490,
        typicalDepartureMin: 820,
      );
      expect(zoneStatsLines(s, now), [
        '12 визитов · в среднем 5 ч 30 мин · всего 2 д 18 ч',
        'обычно приходит в 08:10, уходит в 13:40',
        'последний визит: 29.09, 08:05–13:40',
      ]);
    });

    test('обычное время частично, визит через полночь', () {
      final s = ZoneChildStats(
        childId: 'c1',
        visits: 1,
        totalSec: 36000,
        avgSec: 36000,
        daysCount: 2,
        lastVisitFrom: DateTime(2026, 9, 28, 21, 0),
        lastVisitTo: DateTime(2026, 9, 29, 7, 0),
        typicalArrivalMin: 1260,
      );
      expect(zoneStatsLines(s, now), [
        '1 визит · в среднем 10 ч · всего 10 ч',
        'обычно приходит в 21:00',
        'последний визит: 28.09, 21:00 – 29.09, 07:00',
      ]);
    });

    test('сейчас здесь — сегодня и со вчера', () {
      final today = ZoneChildStats(
        childId: 'c1',
        visits: 3,
        totalSec: 7200,
        avgSec: 2400,
        daysCount: 3,
        ongoing: true,
        lastVisitFrom: DateTime(2026, 9, 30, 8, 5),
        typicalDepartureMin: 820,
      );
      expect(zoneStatsLines(today, now), [
        '3 визита · в среднем 40 мин · всего 2 ч',
        'обычно уходит в 13:40',
        'сейчас здесь с 08:05',
      ]);
      final sinceYesterday = ZoneChildStats(
        childId: 'c1',
        visits: 3,
        totalSec: 7200,
        avgSec: 2400,
        daysCount: 3,
        ongoing: true,
        lastVisitFrom: DateTime(2026, 9, 29, 21, 30),
      );
      expect(zoneStatsLines(sinceYesterday, now).last, 'сейчас здесь с 29.09, 21:30');
    });
  });

  test('ошибка скрытия подсказки', () {
    final e = DioException(
      requestOptions: RequestOptions(path: '/zones/suggestions/dismiss'),
      type: DioExceptionType.badResponse,
      error: ApiException(status: 418, code: 'teapot'),
    );
    expect(zoneErrorMessage(e, ZoneAction.dismiss), 'Не удалось скрыть подсказку (ошибка 418).');
    expect(zoneErrorMessage(Exception('x'), ZoneAction.dismiss), 'Не удалось скрыть подсказку.');
  });
}
