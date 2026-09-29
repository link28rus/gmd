import 'dart:io' show SocketException;
import 'dart:math' as math;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../core/api/api_exception.dart';
import 'zone_models.dart';

// Чистые функции экрана геозон. Повторяют `apps/web/app/cabinet/zones/components/
// zone-format.ts` и `zone-rules-fields.tsx`, чтобы кабинет и приложение
// говорили одно и то же. Покрыты `test/unit/zone_format_test.dart`.

// ---------------------------------------------------------------------------
// Минуты суток ↔ «HH:MM», маска дней
// ---------------------------------------------------------------------------

/// Подписи дней в порядке битов маски: бит 0 — Пн … бит 6 — Вс.
const kWeekdayShort = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const kDaysAll = 0x7F; // 0b1111111
const kDaysWorkdays = 0x1F; // 0b0011111

/// 510 → «08:30». Значение приводится к суткам (0..1439).
String minutesToHhmm(int min) {
  final m = ((min % 1440) + 1440) % 1440;
  final h = m ~/ 60;
  return '${h.toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';
}

final _hhmmRe = RegExp(r'^(\d{1,2}):(\d{2})$');

/// «08:30» → 510; «8:05» тоже принимается. Невалидное или пустое — null.
int? hhmmToMinutes(String s) {
  final m = _hhmmRe.firstMatch(s.trim());
  if (m == null) return null;
  final h = int.parse(m.group(1)!);
  final min = int.parse(m.group(2)!);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

bool hasDay(int mask, int day) => (mask & (1 << day)) != 0;

int toggleDay(int mask, int day) => (mask ^ (1 << day)) & kDaysAll;

/// 31 → «Пн–Пт», 127 → «ежедневно», 96 → «Сб, Вс», 21 → «Пн, Ср, Пт».
/// Подряд три дня и больше — диапазоном.
String formatDaysMask(int mask) {
  final m = mask & kDaysAll;
  if (m == kDaysAll) return 'ежедневно';
  if (m == 0) return 'дни не выбраны';
  final parts = <String>[];
  var d = 0;
  while (d < 7) {
    if (!hasDay(m, d)) {
      d++;
      continue;
    }
    var end = d;
    while (end + 1 < 7 && hasDay(m, end + 1)) {
      end++;
    }
    if (end - d >= 2) {
      parts.add('${kWeekdayShort[d]}–${kWeekdayShort[end]}');
    } else {
      for (var i = d; i <= end; i++) {
        parts.add(kWeekdayShort[i]);
      }
    }
    d = end + 1;
  }
  return parts.join(', ');
}

/// Окно расписания переходит через полночь (22:00–07:00).
bool isOvernight(int startMin, int endMin) => endMin < startMin;

/// { daysMask: 31, startMin: 480, endMin: 900 } → «Пн–Пт 08:00–15:00».
String formatScheduleShort(ZoneSchedule s) =>
    '${formatDaysMask(s.daysMask)} ${minutesToHhmm(s.startMin)}–${minutesToHhmm(s.endMin)}';

// ---------------------------------------------------------------------------
// Длительность, давность, даты ленты
// ---------------------------------------------------------------------------

/// 5400 → «1 ч 30 мин», 90000 → «1 д 1 ч», 40 → «меньше минуты».
String formatDuration(int totalSec) {
  final s = math.max(0, totalSec);
  if (s < 60) return 'меньше минуты';
  final minutes = s ~/ 60;
  if (minutes < 60) return '$minutes мин';
  final hours = minutes ~/ 60;
  final restMin = minutes % 60;
  if (hours < 24) return restMin > 0 ? '$hours ч $restMin мин' : '$hours ч';
  final days = hours ~/ 24;
  final restH = hours % 24;
  return restH > 0 ? '$days д $restH ч' : '$days д';
}

/// Давность точки: «только что», «5 мин назад», «3 ч назад», «2 дн назад».
String formatAgeShort(int ageSec) {
  final s = math.max(0, ageSec);
  if (s < 45) return 'только что';
  if (s < 90) return '1 мин назад';
  if (s < 3600) return '${(s / 60).round()} мин назад';
  final hours = (s / 3600).round();
  if (hours < 24) return '$hours ч назад';
  return '${(s / 86400).round()} дн назад';
}

const _monthsGenitive = [
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

/// Ключ календарного дня (в поясе переданного DateTime).
String localDayKey(DateTime d) => '${d.year}-${d.month}-${d.day}';

/// «Сегодня», «Вчера», «12 сентября», «12 сентября 2025».
String dayLabel(DateTime d, DateTime now) {
  if (localDayKey(d) == localDayKey(now)) return 'Сегодня';
  final y = DateTime(now.year, now.month, now.day - 1);
  if (localDayKey(d) == localDayKey(y)) return 'Вчера';
  final base = '${d.day} ${_monthsGenitive[d.month - 1]}';
  return d.year == now.year ? base : '$base ${d.year}';
}

/// «08:05».
String formatClock(DateTime d) =>
    '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

/// Группа событий одного дня для ленты.
@immutable
class ZoneEventDayGroup {
  const ZoneEventDayGroup(this.key, this.label, this.items);
  final String key;
  final String label;
  final List<ZoneEvent> items;
}

/// События (уже в порядке recordedAt desc) → группы по дням.
List<ZoneEventDayGroup> groupEventsByDay(List<ZoneEvent> events, DateTime now) {
  final groups = <ZoneEventDayGroup>[];
  for (final e in events) {
    final key = localDayKey(e.recordedAt);
    if (groups.isNotEmpty && groups.last.key == key) {
      groups.last.items.add(e);
    } else {
      groups.add(ZoneEventDayGroup(key, dayLabel(e.recordedAt, now), [e]));
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Текст события ленты
// ---------------------------------------------------------------------------

enum ZoneEventTone { normal, alert, warning }

/// Строка ленты по частям: «{child} — {action} «{zone}»{extra}». Части нужны
/// экрану, чтобы покрасить действие и имя зоны.
@immutable
class ZoneEventLine {
  const ZoneEventLine({
    required this.childName,
    required this.action,
    required this.zoneName,
    this.extra,
    this.tone = ZoneEventTone.normal,
  });

  final String childName;
  final String action;
  final String zoneName;

  /// « · пробыл(а) 1 ч 30 мин» у выхода.
  final String? extra;
  final ZoneEventTone tone;

  String get plain => '$childName — $action «$zoneName»${extra ?? ''}';
}

/// Тексты как в ленте кабинета, нейтрально по роду. [deadlineMin] — срок зоны
/// из её текущих настроек (в событии его нет).
ZoneEventLine zoneEventLine(ZoneEvent e, {int? deadlineMin}) {
  switch (e.type) {
    case ZoneEventType.entry:
      return ZoneEventLine(childName: e.childName, action: 'вход в', zoneName: e.zoneName);
    case ZoneEventType.exit:
      final d = e.durationSec;
      return ZoneEventLine(
        childName: e.childName,
        action: 'выход из',
        zoneName: e.zoneName,
        extra: d != null ? ' · пробыл(а) ${formatDuration(d)}' : null,
      );
    case ZoneEventType.missedArrival:
      return ZoneEventLine(
        childName: e.childName,
        action: deadlineMin != null
            ? 'не пришёл(а) к ${minutesToHhmm(deadlineMin)} в'
            : 'не пришёл(а) в',
        zoneName: e.zoneName,
        tone: ZoneEventTone.alert,
      );
    case ZoneEventType.noData:
      return ZoneEventLine(
        childName: e.childName,
        action: 'нет данных от телефона к сроку',
        zoneName: e.zoneName,
        tone: ZoneEventTone.warning,
      );
    case ZoneEventType.unknown:
      return ZoneEventLine(childName: e.childName, action: 'событие в', zoneName: e.zoneName);
  }
}

// ---------------------------------------------------------------------------
// Черновики блоков «Расписание» и «Не пришёл к сроку»
// ---------------------------------------------------------------------------

@immutable
class ScheduleDraft {
  const ScheduleDraft({
    required this.on,
    required this.daysMask,
    required this.startMin,
    required this.endMin,
  });

  factory ScheduleDraft.initial(ZoneSchedule? s) => ScheduleDraft(
        on: s != null,
        daysMask: s?.daysMask ?? kDaysWorkdays,
        startMin: s?.startMin ?? 8 * 60,
        endMin: s?.endMin ?? 15 * 60,
      );

  final bool on;
  final int daysMask;
  final int startMin;
  final int endMin;

  ScheduleDraft copyWith({bool? on, int? daysMask, int? startMin, int? endMin}) =>
      ScheduleDraft(
        on: on ?? this.on,
        daysMask: daysMask ?? this.daysMask,
        startMin: startMin ?? this.startMin,
        endMin: endMin ?? this.endMin,
      );

  /// Текст ошибки или null. Выключенный блок всегда валиден.
  String? get error {
    if (!on) return null;
    if ((daysMask & kDaysAll) == 0) return 'Выберите хотя бы один день.';
    if (startMin == endMin) return 'Время «с» и «до» не должны совпадать.';
    return null;
  }

  /// Выключенный блок = null («снять»).
  ZoneSchedule? get payload =>
      on ? ZoneSchedule(daysMask: daysMask, startMin: startMin, endMin: endMin) : null;
}

@immutable
class ArrivalDraft {
  const ArrivalDraft({
    required this.on,
    required this.deadlineMin,
    required this.daysMask,
    required this.graceMin,
  });

  factory ArrivalDraft.initial(ZoneArrival? a) => ArrivalDraft(
        on: a != null,
        deadlineMin: a?.deadlineMin ?? 8 * 60 + 30,
        daysMask: a?.daysMask ?? kDaysWorkdays,
        graceMin: a?.graceMin ?? kArrivalGraceDefault,
      );

  final bool on;
  final int deadlineMin;
  final int daysMask;
  final int graceMin;

  ArrivalDraft copyWith({bool? on, int? deadlineMin, int? daysMask, int? graceMin}) =>
      ArrivalDraft(
        on: on ?? this.on,
        deadlineMin: deadlineMin ?? this.deadlineMin,
        daysMask: daysMask ?? this.daysMask,
        graceMin: graceMin ?? this.graceMin,
      );

  String? get error {
    if (!on) return null;
    if ((daysMask & kDaysAll) == 0) return 'Выберите хотя бы один день.';
    if (graceMin < kArrivalGraceMin || graceMin > kArrivalGraceMax) {
      return 'Запас — от $kArrivalGraceMin до $kArrivalGraceMax минут.';
    }
    return null;
  }

  ZoneArrival? get payload => on
      ? ZoneArrival(deadlineMin: deadlineMin, daysMask: daysMask, graceMin: graceMin)
      : null;
}

// ---------------------------------------------------------------------------
// Радиус: ползунок 0..1 ↔ метры (логарифмическая шкала)
// ---------------------------------------------------------------------------
//
// Линейный ползунок 100..5000 на телефоне даёт ~15 м на пиксель — 150 м не
// поставить. По логарифму первая треть ползунка — до 400 м.

int clampRadius(num m) =>
    m.round().clamp(kZoneRadiusMin, kZoneRadiusMax).toInt();

/// 0..1 → метры, шаг 10 м (до 1 км) и 50 м (дальше).
int radiusFromSlider(double t) {
  final v = kZoneRadiusMin *
      math.pow(kZoneRadiusMax / kZoneRadiusMin, t.clamp(0.0, 1.0)).toDouble();
  final step = v < 1000 ? 10 : 50;
  return clampRadius((v / step).round() * step);
}

double sliderFromRadius(int radius) {
  final r = clampRadius(radius);
  return math.log(r / kZoneRadiusMin) / math.log(kZoneRadiusMax / kZoneRadiusMin);
}

/// «150 м», «1,2 км».
String formatRadius(int m) {
  if (m < 1000) return '$m м';
  final km = m / 1000;
  final s = km == km.roundToDouble() ? km.toStringAsFixed(0) : km.toStringAsFixed(1);
  return '${s.replaceAll('.', ',')} км';
}

// ---------------------------------------------------------------------------
// Подсказки мест и статистика визитов (этап 4)
// ---------------------------------------------------------------------------

/// Русское склонение по числу: 1 [one], 2–4 [few], 5+ и 11–14 [many].
String pluralRu(int n, String one, String few, String many) {
  final a = n.abs();
  final mod100 = a % 100;
  final mod10 = a % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 == 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/// «1 ночь», «3 ночи», «7 ночей».
String nightsCount(int n) => '$n ${pluralRu(n, 'ночь', 'ночи', 'ночей')}';

/// «1 день», «3 дня», «12 дней».
String daysCount(int n) => '$n ${pluralRu(n, 'день', 'дня', 'дней')}';

/// «1 визит», «3 визита», «12 визитов».
String visitsCount(int n) => '$n ${pluralRu(n, 'визит', 'визита', 'визитов')}';

/// Заголовок карточки подсказки: «Дом?», «Школа?», «Частое место».
String placeSuggestionTitle(String kind) => switch (kind) {
      kPlaceKindHome => 'Дом?',
      kPlaceKindSchool => 'Школа?',
      _ => 'Частое место',
    };

/// Строка-доказательство подсказки по одному ребёнку (без имени):
/// дом — «ночует здесь 7 ночей из 9»; школа — «по будням с 08:10 до 13:40 —
/// 9 дней»; частое место — «бывает здесь 5 дней, обычно 15:00–17:30».
/// Отсутствующее время опускается.
String placeEvidenceLine(String kind, PlaceSuggestionChild c) {
  final from = c.typicalFromMin;
  final to = c.typicalToMin;
  switch (kind) {
    case kPlaceKindHome:
      return 'ночует здесь ${nightsCount(c.days)} из ${c.daysWithData}';
    case kPlaceKindSchool:
      final times = [
        if (from != null) 'с ${minutesToHhmm(from)}',
        if (to != null) 'до ${minutesToHhmm(to)}',
      ];
      final when = times.isEmpty ? 'по будням' : 'по будням ${times.join(' ')}';
      return '$when — ${daysCount(c.days)}';
    default:
      final base = 'бывает здесь ${daysCount(c.days)}';
      if (from != null && to != null) {
        return '$base, обычно ${minutesToHhmm(from)}–${minutesToHhmm(to)}';
      }
      if (from != null) return '$base, обычно с ${minutesToHhmm(from)}';
      if (to != null) return '$base, обычно до ${minutesToHhmm(to)}';
      return base;
  }
}

/// «30.09».
String formatDayMonth(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}';

/// Строки статистики по ребёнку (без имени). Время визитов — локальное время
/// телефона, «обычно» — минуты дня в поясе зоны.
List<String> zoneStatsLines(ZoneChildStats s, DateTime now) {
  if (s.visits <= 0) {
    // «Сейчас здесь» бывает и без закрытых визитов — первый визит ещё идёт.
    if (s.ongoing) return ['визитов не было', _ongoingLine(s.lastVisitFrom, now)];
    return const ['визитов не было'];
  }
  final lines = <String>[
    '${visitsCount(s.visits)} · в среднем ${formatDuration(s.avgSec)} · '
        'всего ${formatDuration(s.totalSec)}',
  ];
  final arr = s.typicalArrivalMin;
  final dep = s.typicalDepartureMin;
  if (arr != null && dep != null) {
    lines.add('обычно приходит в ${minutesToHhmm(arr)}, уходит в ${minutesToHhmm(dep)}');
  } else if (arr != null) {
    lines.add('обычно приходит в ${minutesToHhmm(arr)}');
  } else if (dep != null) {
    lines.add('обычно уходит в ${minutesToHhmm(dep)}');
  }
  final from = s.lastVisitFrom;
  if (s.ongoing) {
    lines.add(_ongoingLine(from, now));
  } else if (from != null) {
    final to = s.lastVisitTo;
    final String range;
    if (to == null) {
      range = '${formatDayMonth(from)}, ${formatClock(from)}';
    } else if (localDayKey(to) == localDayKey(from)) {
      range = '${formatDayMonth(from)}, ${formatClock(from)}–${formatClock(to)}';
    } else {
      range = '${formatDayMonth(from)}, ${formatClock(from)} – '
          '${formatDayMonth(to)}, ${formatClock(to)}';
    }
    lines.add('последний визит: $range');
  }
  return lines;
}

String _ongoingLine(DateTime? from, DateTime now) {
  if (from == null) return 'сейчас здесь';
  final day = localDayKey(from) == localDayKey(now) ? '' : '${formatDayMonth(from)}, ';
  return 'сейчас здесь с $day${formatClock(from)}';
}

// ---------------------------------------------------------------------------
// Ошибки backend'а → русский текст
// ---------------------------------------------------------------------------

enum ZoneAction { save, delete, load, prefs, events, dismiss }

/// ApiException из DioException (его кладёт интерсептор DioFactory) или сам.
ApiException? apiExceptionOf(Object e) {
  if (e is ApiException) return e;
  if (e is DioException && e.error is ApiException) return e.error as ApiException;
  return null;
}

bool _isNetworkError(Object e) {
  if (e is SocketException) return true;
  if (e is! DioException) return false;
  switch (e.type) {
    case DioExceptionType.connectionError:
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return true;
    case DioExceptionType.unknown:
      return e.error is SocketException;
    default:
      return false;
  }
}

/// Русский текст ошибки операции с зоной по `code` ответа backend'а.
String zoneErrorMessage(Object e, ZoneAction action) {
  final api = apiExceptionOf(e);
  if (api != null) {
    switch (api.code) {
      case 'zone_limit_reached':
        return 'Достигнут лимит: в семье может быть не больше $kMaxZones зон.';
      case 'validation_failed':
      case 'bad_request':
        return 'Проверьте поля: название от 1 до 60 символов, радиус от $kZoneRadiusMin '
            'до $kZoneRadiusMax м, дни и время расписания и срока.';
      case 'child_not_found':
        return 'Ребёнок не найден — возможно, его удалили. Обновите список.';
      case 'timezone_required':
        return 'Не удалось определить часовой пояс телефона — расписание и срок '
            'без него не сохранить.';
      case 'invalid_timezone':
        return 'Часовой пояс телефона не распознан сервером — проверьте настройки '
            'даты и времени.';
      case 'zone_not_found':
        return 'Зона не найдена — возможно, её уже удалили.';
      case 'unauthorized':
        return 'Сессия истекла — войдите заново.';
      case 'rate_limited':
        return 'Слишком много запросов — подождите минуту.';
    }
    if (api.status == 401) return 'Сессия истекла — войдите заново.';
    if (api.status == 429) return 'Слишком много запросов — подождите минуту.';
    final status = api.status;
    switch (action) {
      case ZoneAction.delete:
        return 'Не удалось удалить зону (ошибка $status).';
      case ZoneAction.load:
        return 'Не удалось загрузить зоны (ошибка $status).';
      case ZoneAction.prefs:
        return 'Не удалось сохранить настройки уведомлений (ошибка $status).';
      case ZoneAction.events:
        return 'Не удалось загрузить события (ошибка $status).';
      case ZoneAction.dismiss:
        return 'Не удалось скрыть подсказку (ошибка $status).';
      case ZoneAction.save:
        return 'Не удалось сохранить зону (ошибка $status).';
    }
  }
  if (e is DioException && (e.response?.statusCode ?? 0) >= 500) {
    return 'Сервер временно недоступен — попробуйте позже.';
  }
  if (_isNetworkError(e)) {
    return 'Нет связи с сервером — проверьте интернет и попробуйте ещё раз.';
  }
  switch (action) {
    case ZoneAction.delete:
      return 'Не удалось удалить зону.';
    case ZoneAction.load:
      return 'Не удалось загрузить зоны.';
    case ZoneAction.prefs:
      return 'Не удалось сохранить настройки уведомлений.';
    case ZoneAction.events:
      return 'Не удалось загрузить события.';
    case ZoneAction.dismiss:
      return 'Не удалось скрыть подсказку.';
    case ZoneAction.save:
      return 'Не удалось сохранить зону.';
  }
}
