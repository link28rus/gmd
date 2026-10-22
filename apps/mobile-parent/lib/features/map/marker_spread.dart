import 'dart:math' as math;

import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// Веер меток на общей карте семьи (v0.86.0).
///
/// Метки людей — аватар с подписью шириной до ~96 px. Когда двое стоят рядом
/// (родитель забрал ребёнка), подписи налезают и одну метку не видно. Как в
/// картах с «паучком» (spiderfy): налезающие метки раздвигаются по кругу
/// вокруг их общей середины, к настоящему месту каждой ведёт линия.
/// Расчёт в пикселях текущего зума — при отдалении веер собирает больше
/// людей, при приближении расходится сам.

/// Метки ближе этого по обеим осям (px) налезают друг на друга.
const kSpreadOverlapDx = 84.0;
const kSpreadOverlapDy = 60.0;

/// Расстояние между соседями в веере (px) — больше ширины подписи.
const kSpreadGap = 100.0;

/// Возвращает новые позиции только для разведённых меток (ключ → точка).
/// Одиночные метки в ответ не попадают — их рисуют на месте.
Map<String, LatLng> spreadMarkers(Map<String, LatLng> points, {required double zoom}) {
  if (points.length < 2) return const {};
  const crs = Epsg3857();
  // Сортировка ключей — порядок в веере не прыгает между обновлениями.
  final keys = points.keys.toList()..sort();
  final px = [for (final k in keys) crs.latLngToPoint(points[k]!, zoom)];

  // Группы налезающих меток (union-find: цепочка соседей — одна группа).
  final parent = List<int>.generate(keys.length, (i) => i);
  int find(int i) {
    while (parent[i] != i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  for (var i = 0; i < keys.length; i++) {
    for (var j = i + 1; j < keys.length; j++) {
      if ((px[i].x - px[j].x).abs() < kSpreadOverlapDx &&
          (px[i].y - px[j].y).abs() < kSpreadOverlapDy) {
        parent[find(i)] = find(j);
      }
    }
  }
  final groups = <int, List<int>>{};
  for (var i = 0; i < keys.length; i++) {
    groups.putIfAbsent(find(i), () => []).add(i);
  }

  final out = <String, LatLng>{};
  for (final g in groups.values) {
    final n = g.length;
    if (n < 2) continue;
    var cx = 0.0, cy = 0.0;
    for (final i in g) {
      cx += px[i].x;
      cy += px[i].y;
    }
    cx /= n;
    cy /= n;
    // Двое — слева и справа; больше — по кругу, начиная сверху.
    final radius = n == 2 ? kSpreadGap / 2 : kSpreadGap / (2 * math.sin(math.pi / n));
    final start = n == 2 ? math.pi : -math.pi / 2;
    for (var k = 0; k < n; k++) {
      final a = start + 2 * math.pi * k / n;
      final p = math.Point(cx + radius * math.cos(a), cy + radius * math.sin(a));
      out[keys[g[k]]] = crs.pointToLatLng(p, zoom);
    }
  }
  return out;
}
