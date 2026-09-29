import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:periscop_parent/core/api/api_exception.dart';
import 'package:periscop_parent/core/push/push_deeplink.dart';
import 'package:periscop_parent/features/zones/zone_format.dart';
import 'package:periscop_parent/features/zones/zone_map_view.dart';
import 'package:periscop_parent/features/zones/zone_models.dart';

ZoneEvent _event(String type, {int? durationSec, DateTime? at}) => ZoneEvent.fromJson({
      'id': 'e1',
      'zoneId': 'z1',
      'zoneName': 'Школа',
      'zoneColor': '#22c55e',
      'zoneIcon': 'school',
      'childId': 'c1',
      'childName': 'Аня',
      'type': type,
      'lat': 48.48,
      'lon': 135.08,
      'accuracy': 12,
      'recordedAt': (at ?? DateTime.utc(2026, 9, 30, 5, 0)).toIso8601String(),
      'createdAt': '2026-09-30T05:00:01.000Z',
      'durationSec': durationSec,
    });

DioException _dioApi(int status, String? code) => DioException(
      requestOptions: RequestOptions(path: '/zones'),
      type: DioExceptionType.badResponse,
      error: ApiException(status: status, code: code),
    );

void main() {
  group('минуты ↔ HH:MM', () {
    test('minutesToHhmm', () {
      expect(minutesToHhmm(0), '00:00');
      expect(minutesToHhmm(510), '08:30');
      expect(minutesToHhmm(1439), '23:59');
      expect(minutesToHhmm(1440), '00:00');
      expect(minutesToHhmm(-30), '23:30');
    });

    test('hhmmToMinutes', () {
      expect(hhmmToMinutes('08:30'), 510);
      expect(hhmmToMinutes('8:05'), 485);
      expect(hhmmToMinutes(' 23:59 '), 1439);
      expect(hhmmToMinutes('24:00'), isNull);
      expect(hhmmToMinutes('12:60'), isNull);
      expect(hhmmToMinutes(''), isNull);
      expect(hhmmToMinutes('abc'), isNull);
    });

    test('туда и обратно', () {
      for (final m in [0, 1, 59, 60, 510, 900, 1439]) {
        expect(hhmmToMinutes(minutesToHhmm(m)), m);
      }
    });
  });

  group('маска дней', () {
    test('hasDay / toggleDay — бит 0 понедельник, бит 6 воскресенье', () {
      expect(hasDay(1, 0), isTrue);
      expect(hasDay(64, 6), isTrue);
      expect(hasDay(31, 5), isFalse);
      expect(toggleDay(31, 5), 63);
      expect(toggleDay(63, 5), 31);
      expect(toggleDay(0, 6), 64);
    });

    test('formatDaysMask', () {
      expect(formatDaysMask(31), 'Пн–Пт');
      expect(formatDaysMask(127), 'ежедневно');
      expect(formatDaysMask(96), 'Сб, Вс');
      expect(formatDaysMask(21), 'Пн, Ср, Пт');
      expect(formatDaysMask(0x77), 'Пн–Ср, Пт–Вс');
      expect(formatDaysMask(0), 'дни не выбраны');
      expect(formatDaysMask(3), 'Пн, Вт');
    });

    test('расписание коротко и через полночь', () {
      expect(
        formatScheduleShort(const ZoneSchedule(daysMask: 31, startMin: 480, endMin: 900)),
        'Пн–Пт 08:00–15:00',
      );
      expect(isOvernight(22 * 60, 7 * 60), isTrue);
      expect(isOvernight(480, 900), isFalse);
    });
  });

  group('черновики правил', () {
    test('выключенный блок валиден и даёт null', () {
      final s = ScheduleDraft.initial(null);
      expect(s.on, isFalse);
      expect(s.error, isNull);
      expect(s.payload, isNull);
      final a = ArrivalDraft.initial(null);
      expect(a.on, isFalse);
      expect(a.payload, isNull);
      expect(a.graceMin, kArrivalGraceDefault);
      expect(a.deadlineMin, 510);
    });

    test('ошибки расписания', () {
      final s = ScheduleDraft.initial(null).copyWith(on: true);
      expect(s.error, isNull);
      expect(s.copyWith(daysMask: 0).error, 'Выберите хотя бы один день.');
      expect(s.copyWith(startMin: 600, endMin: 600).error,
          'Время «с» и «до» не должны совпадать.');
      expect(s.payload!.toJson(), {'daysMask': 31, 'startMin': 480, 'endMin': 900});
    });

    test('ошибки срока', () {
      final a = ArrivalDraft.initial(null).copyWith(on: true);
      expect(a.error, isNull);
      expect(a.copyWith(daysMask: 0).error, 'Выберите хотя бы один день.');
      expect(a.copyWith(graceMin: 121).error, isNotNull);
      expect(a.payload!.toJson(), {'deadlineMin': 510, 'daysMask': 31, 'graceMin': 10});
    });

    test('черновик из существующей зоны', () {
      final s = ScheduleDraft.initial(
          const ZoneSchedule(daysMask: 96, startMin: 1320, endMin: 420));
      expect(s.on, isTrue);
      expect(s.daysMask, 96);
      expect(s.startMin, 1320);
    });
  });

  group('длительность и давность', () {
    test('formatDuration', () {
      expect(formatDuration(40), 'меньше минуты');
      expect(formatDuration(60), '1 мин');
      expect(formatDuration(3600), '1 ч');
      expect(formatDuration(5400), '1 ч 30 мин');
      expect(formatDuration(86400), '1 д');
      expect(formatDuration(90000), '1 д 1 ч');
      expect(formatDuration(-5), 'меньше минуты');
    });

    test('formatAgeShort', () {
      expect(formatAgeShort(10), 'только что');
      expect(formatAgeShort(60), '1 мин назад');
      expect(formatAgeShort(600), '10 мин назад');
      expect(formatAgeShort(7200), '2 ч назад');
      expect(formatAgeShort(2 * 86400), '2 дн назад');
    });
  });

  group('даты ленты', () {
    final now = DateTime(2026, 9, 30, 12);
    test('dayLabel', () {
      expect(dayLabel(DateTime(2026, 9, 30, 0, 5), now), 'Сегодня');
      expect(dayLabel(DateTime(2026, 9, 29, 23, 59), now), 'Вчера');
      expect(dayLabel(DateTime(2026, 9, 12, 8), now), '12 сентября');
      expect(dayLabel(DateTime(2025, 12, 31, 8), now), '31 декабря 2025');
      // Вчера через границу месяца.
      expect(dayLabel(DateTime(2026, 9, 30, 8), DateTime(2026, 10, 1, 9)), 'Вчера');
    });

    test('группировка по дням сохраняет порядок', () {
      final events = [
        _event('entry', at: DateTime(2026, 9, 30, 10)),
        _event('exit', at: DateTime(2026, 9, 30, 8)),
        _event('entry', at: DateTime(2026, 9, 29, 20)),
      ];
      final groups = groupEventsByDay(events, now);
      expect(groups.map((g) => g.label), ['Сегодня', 'Вчера']);
      expect(groups.first.items.length, 2);
    });

    test('formatClock', () {
      expect(formatClock(DateTime(2026, 9, 30, 8, 5)), '08:05');
    });
  });

  group('тексты ленты', () {
    test('вход', () {
      expect(zoneEventLine(_event('entry')).plain, 'Аня — вход в «Школа»');
    });

    test('выход с длительностью и без', () {
      expect(zoneEventLine(_event('exit', durationSec: 5400)).plain,
          'Аня — выход из «Школа» · пробыл(а) 1 ч 30 мин');
      expect(zoneEventLine(_event('exit')).plain, 'Аня — выход из «Школа»');
    });

    test('не пришёл(а) к сроку', () {
      final line = zoneEventLine(_event('missed_arrival'), deadlineMin: 510);
      expect(line.plain, 'Аня — не пришёл(а) к 08:30 в «Школа»');
      expect(line.tone, ZoneEventTone.alert);
      expect(zoneEventLine(_event('missed_arrival')).plain, 'Аня — не пришёл(а) в «Школа»');
    });

    test('нет данных', () {
      final line = zoneEventLine(_event('no_data'));
      expect(line.plain, 'Аня — нет данных от телефона к сроку «Школа»');
      expect(line.tone, ZoneEventTone.warning);
    });

    test('неизвестный тип не падает', () {
      expect(zoneEventLine(_event('teleport')).plain, 'Аня — событие в «Школа»');
    });
  });

  group('DTO', () {
    test('Zone.fromJson — полный ZoneDto v2', () {
      final z = Zone.fromJson({
        'id': 'z1',
        'familyId': 'f1',
        'name': 'Школа',
        'color': '#3b82f6',
        'icon': 'school',
        'centerLat': 48.48,
        'centerLon': 135.08,
        'radius': 150,
        'allChildren': false,
        'childIds': ['c1', 'c2'],
        'states': [
          {'childId': 'c1', 'isInside': true},
          {'childId': 'c2', 'isInside': false},
        ],
        'timezone': 'Asia/Vladivostok',
        'schedule': {'daysMask': 31, 'startMin': 480, 'endMin': 900},
        'arrival': {'deadlineMin': 510, 'daysMask': 31, 'graceMin': 10},
        'myPrefs': [
          {'childId': 'c1', 'onEntry': true, 'onExit': false, 'onMissedArrival': true},
        ],
        'createdBy': 'u1',
        'createdAt': '2026-09-29T10:00:00.000Z',
        'updatedAt': '2026-09-29T10:00:00.000Z',
      });
      expect(z.radius, 150);
      expect(z.insideChildIds, ['c1']);
      expect(z.appliesTo('c2'), isTrue);
      expect(z.appliesTo('c3'), isFalse);
      expect(z.schedule!.endMin, 900);
      expect(z.arrival!.deadlineMin, 510);
      expect(z.myPrefs.single.onExit, isFalse);
      expect(z.timezone, 'Asia/Vladivostok');
    });

    test('Zone.fromJson — старый ответ без полей v2', () {
      final z = Zone.fromJson({
        'id': 'z1',
        'name': 'Дом',
        'color': '#22c55e',
        'icon': 'home',
        'centerLat': 55,
        'centerLon': 37,
        'radius': 50,
        'schedule': null,
        'arrival': null,
      });
      expect(z.allChildren, isFalse);
      expect(z.childIds, isEmpty);
      expect(z.states, isEmpty);
      expect(z.schedule, isNull);
      expect(z.myPrefs, isEmpty);
      expect(z.appliesTo('c1'), isFalse);
    });

    test('allChildren — зона применима к любому ребёнку', () {
      final z = Zone.fromJson({
        'id': 'z1',
        'name': 'Дом',
        'centerLat': 55,
        'centerLon': 37,
        'radius': 150,
        'allChildren': true,
      });
      expect(z.appliesTo('anyone'), isTrue);
    });

    test('ZoneEventsPage и типы событий', () {
      final page = ZoneEventsPage.fromJson({
        'items': [
          {
            'id': 'e1',
            'zoneId': 'z1',
            'zoneName': 'Школа',
            'zoneColor': '#22c55e',
            'zoneIcon': 'school',
            'childId': 'c1',
            'childName': 'Аня',
            'type': 'no_data',
            'lat': 1,
            'lon': 2,
            'accuracy': null,
            'recordedAt': '2026-09-30T05:00:00.000Z',
            'createdAt': '2026-09-30T05:00:00.000Z',
            'durationSec': null,
          },
        ],
        'nextCursor': 'abc',
      });
      expect(page.nextCursor, 'abc');
      expect(page.items.single.type, ZoneEventType.noData);
      expect(page.items.single.accuracy, isNull);
      expect(page.items.single.recordedAt.isUtc, isFalse); // показываем местное
      expect(parseZoneEventType('missed_arrival'), ZoneEventType.missedArrival);
      expect(parseZoneEventType('exit'), ZoneEventType.exit);
    });

    test('FamilyLatestPoint и IpCenter', () {
      final p = FamilyLatestPoint.fromJson({
        'childId': 'c1',
        'lat': 48.1,
        'lon': 135.2,
        'accuracy': 15,
        'recordedAt': '2026-09-30T05:00:00.000Z',
        'ageSec': 120,
      });
      expect(p.ageSec, 120);
      expect(p.accuracy, 15);
      final ip = IpCenter.fromJson({
        'lat': 48.48,
        'lon': 135.07,
        'city': 'Khabarovsk',
        'countryCode': 'RU',
        'attribution': 'IP Geolocation by DB-IP',
      });
      expect(ip.attribution, 'IP Geolocation by DB-IP');
    });

    test('ZoneInput.toJson — пояс, выключенные блоки = null, childIds при allChildren', () {
      const input = ZoneInput(
        name: '  Школа ',
        color: '#22c55e',
        icon: 'school',
        centerLat: 1,
        centerLon: 2,
        radius: 150,
        allChildren: true,
        childIds: ['c1'],
        timezone: 'Asia/Vladivostok',
      );
      final json = input.toJson();
      expect(json['name'], 'Школа');
      expect(json['childIds'], isEmpty);
      expect(json['timezone'], 'Asia/Vladivostok');
      expect(json.containsKey('schedule'), isTrue);
      expect(json['schedule'], isNull);
      expect(json['arrival'], isNull);

      const noTz = ZoneInput(
        name: 'Дом',
        color: '#22c55e',
        icon: 'home',
        centerLat: 1,
        centerLon: 2,
        radius: 150,
        allChildren: false,
        childIds: ['c1'],
      );
      expect(noTz.toJson().containsKey('timezone'), isFalse);
      expect(noTz.toJson()['childIds'], ['c1']);
    });

    test('parseZoneColor', () {
      expect(parseZoneColor('#22c55e').toARGB32(), 0xFF22C55E);
      expect(parseZoneColor('bad').toARGB32(), 0xFF64748B);
    });
  });

  group('радиус', () {
    test('ползунок: края и значение по умолчанию', () {
      expect(radiusFromSlider(0), kZoneRadiusMin);
      expect(radiusFromSlider(1), kZoneRadiusMax);
      expect(radiusFromSlider(sliderFromRadius(150)), 150);
      expect(sliderFromRadius(50), 0); // старые зоны меньше 100 м
    });

    test('ползунок монотонный', () {
      var prev = 0;
      for (var i = 0; i <= 100; i++) {
        final r = radiusFromSlider(i / 100);
        expect(r, greaterThanOrEqualTo(prev));
        prev = r;
      }
    });

    test('formatRadius', () {
      expect(formatRadius(150), '150 м');
      expect(formatRadius(1000), '1 км');
      expect(formatRadius(1250), '1,3 км');
    });
  });

  group('ошибки', () {
    test('коды backend', () {
      expect(zoneErrorMessage(_dioApi(409, 'zone_limit_reached'), ZoneAction.save),
          contains('не больше 20 зон'));
      expect(zoneErrorMessage(_dioApi(400, 'validation_failed'), ZoneAction.save),
          startsWith('Проверьте поля'));
      expect(zoneErrorMessage(_dioApi(400, 'bad_request'), ZoneAction.save),
          startsWith('Проверьте поля'));
      expect(zoneErrorMessage(_dioApi(404, 'child_not_found'), ZoneAction.save),
          startsWith('Ребёнок не найден'));
      expect(zoneErrorMessage(_dioApi(404, 'zone_not_found'), ZoneAction.delete),
          startsWith('Зона не найдена'));
      expect(zoneErrorMessage(_dioApi(400, 'timezone_required'), ZoneAction.save),
          contains('часовой пояс'));
      expect(zoneErrorMessage(_dioApi(400, 'invalid_timezone'), ZoneAction.save),
          contains('не распознан'));
    });

    test('неизвестный код — по действию со статусом', () {
      expect(zoneErrorMessage(_dioApi(418, 'teapot'), ZoneAction.delete),
          'Не удалось удалить зону (ошибка 418).');
      expect(zoneErrorMessage(ApiException(status: 403), ZoneAction.prefs),
          'Не удалось сохранить настройки уведомлений (ошибка 403).');
    });

    test('сеть и 5xx', () {
      final net = DioException(
        requestOptions: RequestOptions(path: '/zones'),
        type: DioExceptionType.connectionError,
      );
      expect(zoneErrorMessage(net, ZoneAction.load), startsWith('Нет связи с сервером'));
      final server = DioException(
        requestOptions: RequestOptions(path: '/zones'),
        type: DioExceptionType.badResponse,
        response: Response(requestOptions: RequestOptions(path: '/zones'), statusCode: 502),
      );
      expect(zoneErrorMessage(server, ZoneAction.load), startsWith('Сервер временно'));
    });
  });

  group('центр карты', () {
    test('framePoints: круг даёт 4 края, дети добавляются', () {
      const z = Zone(
        id: 'z',
        name: 'Дом',
        color: '#22c55e',
        icon: 'home',
        centerLat: 55,
        centerLon: 37,
        radius: 1113, // ≈ 0.01° по широте
      );
      final pts = framePoints([z], [const LatLng(55.1, 37.1)]);
      expect(pts.length, 5);
      expect(pts[0].latitude, closeTo(55.01, 0.0005));
      expect(framePoints(const [], const []), isEmpty);
    });

    test('SavedMapView: разбор и защита от мусора', () {
      final v = SavedMapView.tryParse(const SavedMapView(48.5, 135.1, 12).encode());
      expect(v!.lat, 48.5);
      expect(v.zoom, 12);
      expect(SavedMapView.tryParse('{"lat":95,"lon":0,"zoom":3}'), isNull);
      expect(SavedMapView.tryParse('not json'), isNull);
      expect(SavedMapView.tryParse(null), isNull);
    });

    test('zoomForRadius: больше радиус — меньше масштаб', () {
      expect(zoomForRadius(150, 55), greaterThan(zoomForRadius(3000, 55)));
      expect(zoomForRadius(150, 55), inInclusiveRange(3, 18));
    });
  });

  group('переход из push', () {
    test('GEOFENCE_* → лента зоны с фильтром по ребёнку', () {
      final link = PushDeepLink.fromMap(
          {'type': 'GEOFENCE_MISSED', 'childId': 'c1', 'zoneId': 'z1'})!;
      expect(link.route, '/home/zones/events?zoneId=z1&childId=c1');
      expect(
        PushDeepLink.fromMap({'type': 'GEOFENCE_ENTER', 'zoneId': 'z1'})!.route,
        '/home/zones/events?zoneId=z1',
      );
    });

    test('остальные → экран ребёнка; без id — некуда', () {
      expect(PushDeepLink.fromMap({'type': 'SOS', 'childId': 'c1'})!.route, '/home/child/c1');
      expect(
        PushDeepLink.fromMap({'type': 'GEOFENCE_EXIT', 'childId': 'c1'})!.route,
        '/home/child/c1',
      );
      expect(PushDeepLink.fromMap({'type': 'LOW_BATTERY'})!.route, isNull);
      expect(PushDeepLink.fromMap({'childId': 'c1'}), isNull);
      expect(PushDeepLink.fromMap(null), isNull);
    });
  });
}
