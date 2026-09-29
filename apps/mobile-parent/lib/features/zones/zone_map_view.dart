import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'zone_models.dart';

/// Центр карты геозон — та же цепочка, что в кабинете (спека 1.6, 3.1):
/// зоны и дети (fitCamera) → последний вид (локально) → `/geo/ip-center`
/// → Москва.

const kMoscow = LatLng(55.7558, 37.6173);
const kMoscowZoom = 10.0;
const kIpCenterZoom = 11.0;

@immutable
class SavedMapView {
  const SavedMapView(this.lat, this.lon, this.zoom);
  final double lat;
  final double lon;
  final double zoom;

  LatLng get center => LatLng(lat, lon);

  static SavedMapView? tryParse(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final v = jsonDecode(raw);
      if (v is! Map) return null;
      final lat = v['lat'];
      final lon = v['lon'];
      final zoom = v['zoom'];
      if (lat is! num || lon is! num || zoom is! num) return null;
      if (!lat.isFinite || !lon.isFinite || !zoom.isFinite) return null;
      if (lat.abs() > 90 || lon.abs() > 180) return null;
      return SavedMapView(lat.toDouble(), lon.toDouble(), zoom.toDouble());
    } catch (_) {
      return null; // битое значение — просто нет сохранённого вида
    }
  }

  String encode() => jsonEncode({'lat': lat, 'lon': lon, 'zoom': zoom});
}

/// Ключ с userId: у двух родителей на одном телефоне — свои виды.
String zonesMapViewKey(String userId) => 'zones_map_view:$userId';

Future<SavedMapView?> readSavedMapView(String? userId) async {
  if (userId == null) return null;
  final prefs = await SharedPreferences.getInstance();
  return SavedMapView.tryParse(prefs.getString(zonesMapViewKey(userId)));
}

Future<void> writeSavedMapView(String? userId, SavedMapView v) async {
  if (userId == null) return;
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(zonesMapViewKey(userId), v.encode());
}

/// Точки, которые должны попасть в кадр: края кругов зон и точки детей.
/// Пусто — зон и точек нет, центр берём дальше по цепочке.
List<LatLng> framePoints(List<Zone> zones, Iterable<LatLng> kids) {
  final out = <LatLng>[];
  for (final z in zones) {
    // Край круга по широте/долготе — чтобы круг целиком попал в кадр.
    final dLat = z.radius / 111320.0;
    final cosLat = math.cos(z.centerLat * math.pi / 180).abs();
    final dLon = z.radius / (111320.0 * math.max(cosLat, 0.01));
    out
      ..add(LatLng((z.centerLat + dLat).clamp(-90, 90), z.centerLon))
      ..add(LatLng((z.centerLat - dLat).clamp(-90, 90), z.centerLon))
      ..add(LatLng(z.centerLat, (z.centerLon + dLon).clamp(-180, 180)))
      ..add(LatLng(z.centerLat, (z.centerLon - dLon).clamp(-180, 180)));
  }
  out.addAll(kids);
  return out;
}

/// Масштаб, при котором круг радиуса [radiusM] занимает примерно треть
/// ширины экрана (редактор существующей зоны).
double zoomForRadius(int radiusM, double latDeg) {
  // На zoom z один пиксель ≈ 156543·cos(lat)/2^z м. Хотим диаметр ≈ 240 px.
  final metersPerPx = (2 * radiusM) / 240;
  final cosLat = math.max(math.cos(latDeg * math.pi / 180).abs(), 0.01);
  final z = math.log(156543.03392 * cosLat / metersPerPx) / math.ln2;
  return z.clamp(3.0, 18.0);
}
