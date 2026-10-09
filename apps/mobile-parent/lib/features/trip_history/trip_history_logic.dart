import 'package:flutter/painting.dart';

import '../children/child_models.dart';
import '../children/track_gaps.dart';
import '../zones/zone_models.dart';

/// Чистая логика экрана «История передвижений»: группировка поездок по
/// дням, цвета, подписи времени/расстояния и привязка точек к геозонам.
///
/// Порт `apps/web/lib/history/trip-history.ts` — правишь здесь, правь и там.

/// Цвета поездок внутри дня — одни и те же в списке, на ленте суток и на
/// карте (как в веб-кабинете).
const kTripColors = <Color>[
  Color(0xFF2563EB),
  Color(0xFFDB2777),
  Color(0xFF059669),
  Color(0xFFD97706),
  Color(0xFF7C3AED),
  Color(0xFF0891B2),
];

class DayTrip {
  const DayTrip({required this.trip, required this.ordinal, required this.color});

  final Trip trip;

  /// Номер поездки за день по порядку, с 1.
  final int ordinal;
  final Color color;
}

class TripDay {
  const TripDay({
    required this.key,
    required this.date,
    required this.trips,
    required this.distanceM,
    required this.moving,
  });

  /// Локальная дата «YYYY-MM-DD».
  final String key;

  /// Локальная полночь дня.
  final DateTime date;

  /// Поездки по времени начала, утро сверху.
  final List<DayTrip> trips;
  final int distanceM;
  final Duration moving;
}

String _pad(int n) => n.toString().padLeft(2, '0');

String dayKeyOf(DateTime d) => '${d.year}-${_pad(d.month)}-${_pad(d.day)}';

DateTime _startOfDay(DateTime d) => DateTime(d.year, d.month, d.day);

DateTime tripEnd(Trip t, DateTime now) => t.endedAt ?? now;

Duration tripDuration(Trip t, DateTime now) {
  final d = tripEnd(t, now).difference(t.startedAt);
  return d.isNegative ? Duration.zero : d;
}

/// Дни, новые сверху. Поездка через полночь относится к дню старта.
List<TripDay> groupTripsByDay(List<Trip> trips, DateTime now) {
  final byKey = <String, List<Trip>>{};
  for (final t in trips) {
    byKey.putIfAbsent(dayKeyOf(t.startedAt), () => []).add(t);
  }
  final days = <TripDay>[];
  byKey.forEach((key, list) {
    list.sort((a, b) => a.startedAt.compareTo(b.startedAt));
    days.add(TripDay(
      key: key,
      date: _startOfDay(list.first.startedAt),
      trips: [
        for (var i = 0; i < list.length; i++)
          DayTrip(trip: list[i], ordinal: i + 1, color: kTripColors[i % kTripColors.length]),
      ],
      distanceM: list.fold(0, (s, t) => s + t.distanceM),
      moving: list.fold(Duration.zero, (s, t) => s + tripDuration(t, now)),
    ));
  });
  days.sort((a, b) => b.date.compareTo(a.date));
  return days;
}

/// Положение поездки на ленте суток: доли [0..1] от начала дня.
({double left, double width}) ribbonSpan(Trip trip, DateTime dayStart, DateTime now) {
  // Сутки считаем от следующей полуночи, а не +24 ч — в дни перевода
  // часов в сутках 23 или 25 часов.
  final dayMs = DateTime(dayStart.year, dayStart.month, dayStart.day + 1)
      .difference(dayStart)
      .inMilliseconds;
  double frac(DateTime t) => (t.difference(dayStart).inMilliseconds / dayMs).clamp(0.0, 1.0);
  final from = frac(trip.startedAt);
  final to = frac(tripEnd(trip, now));
  return (left: from, width: to < from ? 0 : to - from);
}

const _weekdays = <String>[
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];
const _monthsGen = <String>[
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/// «Сегодня» / «Вчера» / «Понедельник» + «9 октября».
({String title, String date}) dayTitle(DateTime date, DateTime now) {
  final today = _startOfDay(now);
  final yesterday = DateTime(today.year, today.month, today.day - 1);
  final title = date == today
      ? 'Сегодня'
      : date == yesterday
          ? 'Вчера'
          : _weekdays[date.weekday - 1];
  final year = date.year != now.year ? ' ${date.year}' : '';
  return (title: title, date: '${date.day} ${_monthsGen[date.month - 1]}$year');
}

String fmtClock(DateTime d) => '${_pad(d.hour)}:${_pad(d.minute)}';

String fmtDuration(Duration d) {
  var min = (d.inSeconds / 60).round();
  if (min < 1) min = 1;
  if (min < 60) return '$min мин';
  final h = min ~/ 60;
  final rest = min % 60;
  return rest > 0 ? '$h ч $rest мин' : '$h ч';
}

String fmtDistance(int m) {
  if (m < 1000) return '$m м';
  final km = m / 1000;
  return km < 10 ? '${km.toStringAsFixed(1).replaceAll('.', ',')} км' : '${km.round()} км';
}

/// Средняя скорость в км/ч; null — поездка слишком короткая, чтобы считать.
int? avgSpeedKmh(int distanceM, Duration d) {
  if (d.inSeconds < 60 || distanceM < 50) return null;
  return (distanceM / 1000 / (d.inSeconds / 3600)).round();
}

String pluralRu(int n, String one, String few, String many) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/// Запас к радиусу зоны: GPS на старте/финише часто «гуляет» на десятки метров.
const _kZoneSlackM = 30;

/// Геозона, в которой находится точка. Из пересекающихся берём самую
/// маленькую — она точнее описывает место («Школа» внутри «Район»).
Zone? zoneAt(List<Zone> zones, double lat, double lon) {
  Zone? best;
  for (final z in zones) {
    final d = haversineMeters(lat, lon, z.centerLat, z.centerLon);
    if (d <= z.radius + _kZoneSlackM && (best == null || z.radius < best.radius)) best = z;
  }
  return best;
}

/// Ключ точки для обратного геокодинга: «lon,lat» с точностью ~10 м
/// (тот же формат, что у веб-кабинета и серверного кэша).
String reverseKey(double lat, double lon) =>
    '${lon.toStringAsFixed(4)},${lat.toStringAsFixed(4)}';
