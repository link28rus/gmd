import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:periscop_parent/features/children/child_models.dart';
import 'package:periscop_parent/features/children/widgets/track_layers.dart';

const _lat0 = 55.75;
const _lon0 = 37.62;
final _t0 = DateTime.utc(2026, 9, 28, 7, 0);

Map<String, dynamic> _pointJson(double dLat, int minute) => {
      'lat': _lat0 + dLat,
      'lon': _lon0,
      'recordedAt': _t0.add(Duration(minutes: minute)).toIso8601String(),
    };

ChildLocation _p(double dLat, int minute) => ChildLocation(
      lat: _lat0 + dLat,
      lon: _lon0,
      recordedAt: _t0.add(Duration(minutes: minute)).toLocal(),
    );

TrackStay _stay(double dLat, DateTime from, Duration d) =>
    TrackStay(lat: _lat0 + dLat, lon: _lon0, from: from, to: from.add(d));

void main() {
  group('TrackData.fromJson', () {
    test('stays есть — парсятся координаты и время (в локальную зону)', () {
      final data = TrackData.fromJson({
        'trip': null,
        'points': [_pointJson(0, 0), _pointJson(0.001, 1)],
        'stays': [
          {
            'lat': 55.751,
            'lon': 37.621,
            'from': '2026-09-28T07:05:00.000Z',
            'to': '2026-09-28T07:20:00.000Z',
          },
        ],
      });
      expect(data.points, hasLength(2));
      expect(data.stays, hasLength(1));
      final s = data.stays.single;
      expect(s.lat, 55.751);
      expect(s.lon, 37.621);
      expect(s.from, DateTime.utc(2026, 9, 28, 7, 5).toLocal());
      expect(s.from.isUtc, isFalse);
      expect(s.to, DateTime.utc(2026, 9, 28, 7, 20).toLocal());
      expect(s.duration, const Duration(minutes: 15));
    });

    test('старый сервер: поля stays нет — пустой список', () {
      final data = TrackData.fromJson({
        'points': [_pointJson(0, 0), _pointJson(0.001, 1)],
      });
      expect(data.points, hasLength(2));
      expect(data.stays, isEmpty);
    });

    test('stays: null и points: null — пустые списки', () {
      final data = TrackData.fromJson({'trip': null, 'points': null, 'stays': null});
      expect(data.points, isEmpty);
      expect(data.stays, isEmpty);
    });

    test('lat/lon целыми числами — приводятся к double', () {
      final data = TrackData.fromJson({
        'points': const [],
        'stays': [
          {
            'lat': 55,
            'lon': 37,
            'from': '2026-09-28T07:05:00Z',
            'to': '2026-09-28T07:08:00Z',
          },
        ],
      });
      expect(data.stays.single.lat, 55.0);
      expect(data.stays.single.lon, 37.0);
    });
  });

  group('formatTrackStayLabel', () {
    final from = DateTime(2026, 9, 28, 13, 5);

    test('минуты', () {
      expect(
        formatTrackStayLabel(_stay(0, from, const Duration(minutes: 15))),
        'Стоял 13:05–13:20 · 15 мин',
      );
    });

    test('ровно часы', () {
      expect(
        formatTrackStayLabel(_stay(0, from, const Duration(hours: 2))),
        'Стоял 13:05–15:05 · 2 ч',
      );
    });

    test('часы и минуты, ведущие нули во времени', () {
      final early = DateTime(2026, 9, 28, 8, 3);
      expect(
        formatTrackStayLabel(
          _stay(0, early, const Duration(hours: 2, minutes: 15)),
        ),
        'Стоял 08:03–10:18 · 2 ч 15 мин',
      );
    });
  });

  group('buildTrackLayers', () {
    test('упрощение flutter_map выключено у линии трека', () {
      final layers = buildTrackLayers([_p(0, 0), _p(0.001, 1), _p(0.002, 2)]);
      final polyline = layers.whereType<PolylineLayer>().single;
      expect(polyline.simplificationTolerance, 0);
    });

    test('без стоянок — слоя маркеров стоянок нет', () {
      final layers = buildTrackLayers([_p(0, 0), _p(0.001, 1)]);
      expect(layers.whereType<MarkerLayer>(), isEmpty);
    });

    test('стоянки — отдельный слой, по маркеру на стоянку, последним', () {
      final from = DateTime(2026, 9, 28, 13, 5);
      final layers = buildTrackLayers(
        [_p(0, 0), _p(0.001, 1), _p(0.002, 30)],
        stays: [
          _stay(0.001, from, const Duration(minutes: 5)),
          _stay(0.002, from.add(const Duration(minutes: 20)), const Duration(minutes: 7)),
        ],
      );
      // Последний слой — стоянки: экраны кладут маркер ребёнка после
      // buildTrackLayers, значит стоянки окажутся под ним.
      final stayLayer = layers.last as MarkerLayer;
      expect(stayLayer.markers, hasLength(2));
      expect(stayLayer.markers.first.point, const LatLng(_lat0 + 0.001, _lon0));
    });

    test('меньше двух точек, но есть стоянка — рисуется только стоянка', () {
      final layers = buildTrackLayers(
        [_p(0, 0)],
        stays: [_stay(0, DateTime(2026, 9, 28, 13, 5), const Duration(minutes: 4))],
      );
      expect(layers.whereType<PolylineLayer>(), isEmpty);
      expect(layers, hasLength(1));
      expect((layers.single as MarkerLayer).markers, hasLength(1));
    });

    test('пусто — нет слоёв', () {
      expect(buildTrackLayers(const []), isEmpty);
    });
  });

  testWidgets('маркер стоянки «П» на карте, по тапу — подсказка', (tester) async {
    final from = DateTime(2026, 9, 28, 13, 5);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 400,
            height: 400,
            child: FlutterMap(
              options: const MapOptions(
                initialCenter: LatLng(_lat0 + 0.001, _lon0),
                initialZoom: 15,
              ),
              children: [
                ...buildTrackLayers(
                  [_p(0, 0), _p(0.001, 1), _p(0.002, 30)],
                  stays: [_stay(0.001, from, const Duration(minutes: 15))],
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('П'), findsOneWidget);
    expect(find.text('Стоял 13:05–13:20 · 15 мин'), findsNothing);

    await tester.tap(find.text('П'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Стоял 13:05–13:20 · 15 мин'), findsOneWidget);

    // Дать подсказке скрыться — чтобы таймер не висел после теста.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });
}
