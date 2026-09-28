import 'dart:math' as math;

import 'child_models.dart';

/// Разрывы трека — участки, где данных о перемещении нет (телефон выключен,
/// сел, долго был без GPS). Без них карта соединяет две соседние точки
/// прямой «через поле», будто ребёнок так ехал.
///
/// Контракт общий с web-кабинетом: между соседними по `recordedAt` точками
/// A→B разрыв, если ОДНОВРЕМЕННО
///   `B.recordedAt − A.recordedAt > kTrackGapMinDuration` И
///   `haversine(A, B) > kTrackGapMinDistanceM`.

/// В движении телефон шлёт точку раз в 5–90 с, так что 5 минут тишины —
/// это пропуск данных, а не редкая отправка.
const kTrackGapMinDuration = Duration(minutes: 5);

/// Прыжок меньше 300 м визуально не врёт (стоял на месте, GPS-дрожание
/// в здании) — рисуем его обычной линией.
const double kTrackGapMinDistanceM = 300;

/// Средний радиус Земли, как в backend `common/geo-distance.ts` и web
/// `lib/geo/douglas-peucker.ts`.
const double _kEarthRadiusM = 6371000;

/// Участок без данных между двумя соседними точками трека.
class TrackGap {
  const TrackGap({required this.from, required this.to});

  /// Последняя точка перед разрывом.
  final ChildLocation from;

  /// Первая точка после разрыва.
  final ChildLocation to;

  Duration get duration => to.recordedAt.difference(from.recordedAt);
}

/// Трек, разрезанный по разрывам.
class TrackSplit {
  const TrackSplit({required this.segments, required this.gaps});

  /// Непрерывные куски трека в порядке времени. Кусок может состоять из
  /// одной точки (одиночная точка между двумя разрывами) — линией его не
  /// нарисовать, но разрывы к нему примыкают.
  final List<List<ChildLocation>> segments;

  /// Разрывы в порядке времени; `gaps[i]` лежит между `segments[i]` и
  /// `segments[i + 1]`.
  final List<TrackGap> gaps;
}

/// Режет трек на непрерывные куски и разрывы. Точки упорядочиваются по
/// `recordedAt` (копия, входной список не меняется).
TrackSplit splitTrackByGaps(List<ChildLocation> points) {
  if (points.isEmpty) return const TrackSplit(segments: [], gaps: []);
  final sorted = [...points]
    ..sort((a, b) => a.recordedAt.compareTo(b.recordedAt));

  final segments = <List<ChildLocation>>[];
  final gaps = <TrackGap>[];
  var current = <ChildLocation>[sorted.first];
  for (var i = 1; i < sorted.length; i++) {
    final a = sorted[i - 1];
    final b = sorted[i];
    if (isTrackGap(a, b)) {
      segments.add(current);
      gaps.add(TrackGap(from: a, to: b));
      current = <ChildLocation>[b];
    } else {
      current.add(b);
    }
  }
  segments.add(current);
  return TrackSplit(segments: segments, gaps: gaps);
}

/// Разрыв ли между соседними точками [a] → [b] (см. контракт выше).
bool isTrackGap(ChildLocation a, ChildLocation b) =>
    b.recordedAt.difference(a.recordedAt) > kTrackGapMinDuration &&
    haversineMeters(a.lat, a.lon, b.lat, b.lon) > kTrackGapMinDistanceM;

/// Расстояние между двумя точками в метрах (haversine).
double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
  double toRad(double d) => d * math.pi / 180;
  final dLat = toRad(lat2 - lat1);
  final dLon = toRad(lon2 - lon1);
  final q =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(toRad(lat1)) *
          math.cos(toRad(lat2)) *
          math.pow(math.sin(dLon / 2), 2);
  return _kEarthRadiusM * 2 * math.atan2(math.sqrt(q), math.sqrt(1 - q));
}

/// Подпись разрыва на карте: «нет данных 12 мин», «нет данных 1 ч 7 мин»,
/// «нет данных 2 ч». Минуты — целые, с округлением вниз.
String formatTrackGapLabel(Duration duration) {
  final total = duration.inMinutes;
  if (total < 60) return 'нет данных $total мин';
  final hours = total ~/ 60;
  final minutes = total % 60;
  return minutes == 0
      ? 'нет данных $hours ч'
      : 'нет данных $hours ч $minutes мин';
}
