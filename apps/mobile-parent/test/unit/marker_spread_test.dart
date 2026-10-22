import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:periscop_parent/features/map/marker_spread.dart';

void main() {
  const crs = Epsg3857();
  const zoom = 16.0;

  double pxDist(LatLng a, LatLng b) {
    final pa = crs.latLngToPoint(a, zoom);
    final pb = crs.latLngToPoint(b, zoom);
    return pa.distanceTo(pb);
  }

  group('spreadMarkers', () {
    test('меньше двух меток — ничего не двигаем', () {
      expect(spreadMarkers({}, zoom: zoom), isEmpty);
      expect(spreadMarkers({'a': const LatLng(55, 37)}, zoom: zoom), isEmpty);
    });

    test('далёкие метки остаются на месте', () {
      final r = spreadMarkers(
        {'a': const LatLng(55, 37), 'b': const LatLng(55.01, 37.01)},
        zoom: zoom,
      );
      expect(r, isEmpty);
    });

    test('двое в одной точке — слева и справа, на ширину подписи', () {
      const p = LatLng(48.48, 135.08);
      final r = spreadMarkers({'kid:1': p, 'parent:u': p}, zoom: zoom);
      expect(r.keys, unorderedEquals(['kid:1', 'parent:u']));
      expect(pxDist(r['kid:1']!, r['parent:u']!), closeTo(kSpreadGap, 0.5));
      // По горизонтали: широта одинаковая.
      expect(r['kid:1']!.latitude, closeTo(r['parent:u']!.latitude, 1e-9));
      // Середина — исходная точка.
      expect(pxDist(r['kid:1']!, p), closeTo(kSpreadGap / 2, 0.5));
    });

    test('трое рядом — по кругу, соседи не ближе kSpreadGap', () {
      const p = LatLng(48.48, 135.08);
      final r = spreadMarkers({
        'a': p,
        'b': const LatLng(48.48001, 135.08001),
        'c': const LatLng(48.47999, 135.08002),
      }, zoom: zoom);
      expect(r, hasLength(3));
      final v = r.values.toList();
      for (var i = 0; i < 3; i++) {
        for (var j = i + 1; j < 3; j++) {
          expect(pxDist(v[i], v[j]), greaterThanOrEqualTo(kSpreadGap - 0.5));
        }
      }
    });

    test('порядок не зависит от порядка входа', () {
      const p = LatLng(48.48, 135.08);
      final r1 = spreadMarkers({'a': p, 'b': p}, zoom: zoom);
      final r2 = spreadMarkers({'b': p, 'a': p}, zoom: zoom);
      expect(r1['a'], r2['a']);
      expect(r1['b'], r2['b']);
    });

    test('при отдалении близкие метки собираются в веер, при приближении — нет', () {
      final pts = {'a': const LatLng(48.48, 135.08), 'b': const LatLng(48.48, 135.0815)};
      expect(spreadMarkers(pts, zoom: 18), isEmpty);
      expect(spreadMarkers(pts, zoom: 13), hasLength(2));
    });
  });
}
