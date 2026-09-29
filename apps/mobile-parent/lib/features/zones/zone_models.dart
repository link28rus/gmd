import 'package:flutter/material.dart';

/// Модели геозон v2 — спецификация `docs/superpowers/specs/2026-09-29-geofences-v2.md`,
/// разделы 1.4 и 2.4. Типы совпадают с web-кабинетом (`apps/web/lib/api/zones.ts`).

/// Лимит зон на семью — backend отвечает 409 `zone_limit_reached`.
const kMaxZones = 20;

/// Границы радиуса по Zod-схеме backend'а (CHECK в БД шире — 50..5000).
const kZoneRadiusMin = 100;
const kZoneRadiusMax = 5000;
const kZoneRadiusDefault = 150;

/// Запас к сроку «не пришёл» (минуты) — границы Zod-схемы backend'а.
const kArrivalGraceMin = 0;
const kArrivalGraceMax = 120;
const kArrivalGraceDefault = 10;

/// Палитра backend'а (`ZONE_COLORS`) — другие цвета он отвергнет.
const kZoneColors = <String>[
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#64748b',
];
const kZoneColorDefault = '#22c55e';

/// Иконки backend'а (`ZONE_ICONS`).
class ZoneIconOption {
  const ZoneIconOption(this.id, this.icon, this.label);
  final String id;
  final IconData icon;
  final String label;
}

const kZoneIcons = <ZoneIconOption>[
  ZoneIconOption('home', Icons.home_outlined, 'Дом'),
  ZoneIconOption('school', Icons.school_outlined, 'Школа'),
  ZoneIconOption('sport', Icons.sports_soccer_outlined, 'Спорт'),
  ZoneIconOption('art', Icons.palette_outlined, 'Творчество'),
  ZoneIconOption('hospital', Icons.local_hospital_outlined, 'Больница'),
  ZoneIconOption('shop', Icons.storefront_outlined, 'Магазин'),
  ZoneIconOption('music', Icons.music_note_outlined, 'Музыка'),
  ZoneIconOption('other', Icons.place_outlined, 'Другое'),
];
const kZoneIconDefault = 'home';

IconData zoneIconData(String id) =>
    kZoneIcons.firstWhere((i) => i.id == id, orElse: () => kZoneIcons.last).icon;

/// «#22c55e» → Color. Невалидное значение — [fallback].
Color parseZoneColor(String? hex, {Color fallback = const Color(0xFF64748B)}) {
  if (hex == null) return fallback;
  final h = hex.startsWith('#') ? hex.substring(1) : hex;
  if (h.length != 6) return fallback;
  final v = int.tryParse(h, radix: 16);
  if (v == null) return fallback;
  return Color(0xFF000000 | v);
}

int _int(Object? v, [int fallback = 0]) => v is num ? v.toInt() : fallback;
double _double(Object? v) => v is num ? v.toDouble() : 0;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
List<Map<String, dynamic>> _maps(Object? v) =>
    v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];

/// Окно уведомлений о приходе/уходе (минуты от начала суток в поясе зоны).
/// `endMin < startMin` — окно через полночь.
@immutable
class ZoneSchedule {
  const ZoneSchedule({
    required this.daysMask,
    required this.startMin,
    required this.endMin,
  });

  /// Бит 0 — понедельник … бит 6 — воскресенье.
  final int daysMask;
  final int startMin;
  final int endMin;

  static ZoneSchedule? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    return ZoneSchedule(
      daysMask: _int(json['daysMask']),
      startMin: _int(json['startMin']),
      endMin: _int(json['endMin']),
    );
  }

  Map<String, dynamic> toJson() =>
      {'daysMask': daysMask, 'startMin': startMin, 'endMin': endMin};
}

/// «Не пришёл к сроку»: срок (минуты от начала суток), дни, запас 0..120 мин.
@immutable
class ZoneArrival {
  const ZoneArrival({
    required this.deadlineMin,
    required this.daysMask,
    required this.graceMin,
  });

  final int deadlineMin;
  final int daysMask;
  final int graceMin;

  static ZoneArrival? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    return ZoneArrival(
      deadlineMin: _int(json['deadlineMin']),
      daysMask: _int(json['daysMask']),
      graceMin: _int(json['graceMin'], kArrivalGraceDefault),
    );
  }

  Map<String, dynamic> toJson() =>
      {'deadlineMin': deadlineMin, 'daysMask': daysMask, 'graceMin': graceMin};
}

/// Личные настройки текущего родителя по одному ребёнку зоны.
@immutable
class ZoneChildPrefs {
  const ZoneChildPrefs({
    required this.childId,
    this.onEntry = true,
    this.onExit = true,
    this.onMissedArrival = true,
  });

  final String childId;
  final bool onEntry;
  final bool onExit;
  final bool onMissedArrival;

  factory ZoneChildPrefs.fromJson(Map<String, dynamic> json) => ZoneChildPrefs(
        childId: json['childId'] as String,
        onEntry: (json['onEntry'] as bool?) ?? true,
        onExit: (json['onExit'] as bool?) ?? true,
        onMissedArrival: (json['onMissedArrival'] as bool?) ?? true,
      );

  ZoneChildPrefs copyWith({bool? onEntry, bool? onExit, bool? onMissedArrival}) =>
      ZoneChildPrefs(
        childId: childId,
        onEntry: onEntry ?? this.onEntry,
        onExit: onExit ?? this.onExit,
        onMissedArrival: onMissedArrival ?? this.onMissedArrival,
      );

  Map<String, dynamic> toJson() => {
        'childId': childId,
        'onEntry': onEntry,
        'onExit': onExit,
        'onMissedArrival': onMissedArrival,
      };

  @override
  bool operator ==(Object other) =>
      other is ZoneChildPrefs &&
      other.childId == childId &&
      other.onEntry == onEntry &&
      other.onExit == onExit &&
      other.onMissedArrival == onMissedArrival;

  @override
  int get hashCode => Object.hash(childId, onEntry, onExit, onMissedArrival);
}

@immutable
class ZoneChildState {
  const ZoneChildState({required this.childId, required this.isInside});
  final String childId;
  final bool isInside;
}

/// `ZoneDto` backend'а.
@immutable
class Zone {
  const Zone({
    required this.id,
    required this.name,
    required this.color,
    required this.icon,
    required this.centerLat,
    required this.centerLon,
    required this.radius,
    this.allChildren = false,
    this.childIds = const [],
    this.states = const [],
    this.timezone,
    this.schedule,
    this.arrival,
    this.myPrefs = const [],
  });

  final String id;
  final String name;
  final String color;
  final String icon;
  final double centerLat;
  final double centerLon;
  final int radius;

  /// Зона для всех детей семьи, включая будущих.
  final bool allChildren;

  /// Явные назначения; пусто при [allChildren].
  final List<String> childIds;
  final List<ZoneChildState> states;

  /// IANA-пояс, в котором заданы расписание и срок; null — не задавался.
  final String? timezone;

  /// null — уведомления круглосуточно.
  final ZoneSchedule? schedule;

  /// null — «не пришёл к сроку» выключено.
  final ZoneArrival? arrival;

  /// Личные настройки текущего пользователя по всем детям зоны (с умолчаниями).
  final List<ZoneChildPrefs> myPrefs;

  factory Zone.fromJson(Map<String, dynamic> json) => Zone(
        id: json['id'] as String,
        name: (json['name'] as String?) ?? '',
        color: (json['color'] as String?) ?? kZoneColorDefault,
        icon: (json['icon'] as String?) ?? 'other',
        centerLat: _double(json['centerLat']),
        centerLon: _double(json['centerLon']),
        radius: _int(json['radius'], kZoneRadiusDefault),
        allChildren: (json['allChildren'] as bool?) ?? false,
        childIds: (json['childIds'] as List? ?? const []).whereType<String>().toList(),
        states: _maps(json['states'])
            .map((s) => ZoneChildState(
                  childId: s['childId'] as String,
                  isInside: (s['isInside'] as bool?) ?? false,
                ))
            .toList(),
        timezone: json['timezone'] as String?,
        schedule: ZoneSchedule.fromJson(json['schedule']),
        arrival: ZoneArrival.fromJson(json['arrival']),
        myPrefs: _maps(json['myPrefs']).map(ZoneChildPrefs.fromJson).toList(),
      );

  /// Применима ли зона к ребёнку (для кругов на карте ребёнка).
  bool appliesTo(String childId) => allChildren || childIds.contains(childId);

  /// Кто из детей сейчас внутри (по серверным `states`).
  List<String> get insideChildIds =>
      states.where((s) => s.isInside).map((s) => s.childId).toList();
}

/// Тело `POST /zones` и `PATCH /zones/:id` — полный набор полей, как в
/// кабинете. `schedule`/`arrival` = null снимают блок; `timezone` уходит при
/// каждом сохранении, если телефон его отдал.
@immutable
class ZoneInput {
  const ZoneInput({
    required this.name,
    required this.color,
    required this.icon,
    required this.centerLat,
    required this.centerLon,
    required this.radius,
    required this.allChildren,
    required this.childIds,
    this.timezone,
    this.schedule,
    this.arrival,
  });

  final String name;
  final String color;
  final String icon;
  final double centerLat;
  final double centerLon;
  final int radius;
  final bool allChildren;
  final List<String> childIds;
  final String? timezone;
  final ZoneSchedule? schedule;
  final ZoneArrival? arrival;

  Map<String, dynamic> toJson() => {
        'name': name.trim(),
        'color': color,
        'icon': icon,
        'centerLat': centerLat,
        'centerLon': centerLon,
        'radius': radius,
        'allChildren': allChildren,
        // При allChildren=true backend их игнорирует — не шлём лишнего.
        'childIds': allChildren ? const <String>[] : childIds,
        'timezone': ?timezone,
        'schedule': schedule?.toJson(),
        'arrival': arrival?.toJson(),
      };
}

enum ZoneEventType { entry, exit, missedArrival, noData, unknown }

ZoneEventType parseZoneEventType(Object? raw) {
  switch (raw) {
    case 'entry':
      return ZoneEventType.entry;
    case 'exit':
      return ZoneEventType.exit;
    case 'missed_arrival':
      return ZoneEventType.missedArrival;
    case 'no_data':
      return ZoneEventType.noData;
    default:
      // Тип из будущей версии backend'а — не падаем.
      return ZoneEventType.unknown;
  }
}

/// Элемент `GET /zones/events`.
@immutable
class ZoneEvent {
  const ZoneEvent({
    required this.id,
    required this.zoneId,
    required this.zoneName,
    required this.zoneColor,
    required this.zoneIcon,
    required this.childId,
    required this.childName,
    required this.type,
    required this.recordedAt,
    this.lat = 0,
    this.lon = 0,
    this.accuracy,
    this.durationSec,
  });

  final String id;
  final String zoneId;
  final String zoneName;
  final String zoneColor;
  final String zoneIcon;
  final String childId;
  final String childName;
  final ZoneEventType type;
  final double lat;
  final double lon;
  final double? accuracy;

  /// Время фикса (локальное) — его и показываем.
  final DateTime recordedAt;

  /// Только у выхода: сколько пробыл(а) в зоне; null — вход не наблюдался.
  final int? durationSec;

  factory ZoneEvent.fromJson(Map<String, dynamic> json) => ZoneEvent(
        id: json['id'] as String,
        zoneId: (json['zoneId'] as String?) ?? '',
        zoneName: (json['zoneName'] as String?) ?? '',
        zoneColor: (json['zoneColor'] as String?) ?? kZoneColorDefault,
        zoneIcon: (json['zoneIcon'] as String?) ?? 'other',
        childId: (json['childId'] as String?) ?? '',
        childName: (json['childName'] as String?) ?? 'Ребёнок',
        type: parseZoneEventType(json['type']),
        lat: _double(json['lat']),
        lon: _double(json['lon']),
        accuracy: (json['accuracy'] as num?)?.toDouble(),
        recordedAt: _date(json['recordedAt']) ?? DateTime.now(),
        durationSec: (json['durationSec'] as num?)?.toInt(),
      );
}

@immutable
class ZoneEventsPage {
  const ZoneEventsPage({required this.items, this.nextCursor});
  final List<ZoneEvent> items;
  final String? nextCursor;

  factory ZoneEventsPage.fromJson(Map<String, dynamic> json) => ZoneEventsPage(
        items: _maps(json['items']).map(ZoneEvent.fromJson).toList(),
        nextCursor: json['nextCursor'] as String?,
      );
}

/// Элемент `GET /family/locations/latest` — последняя хорошая точка ребёнка.
@immutable
class FamilyLatestPoint {
  const FamilyLatestPoint({
    required this.childId,
    required this.lat,
    required this.lon,
    required this.ageSec,
    this.accuracy,
    this.recordedAt,
  });

  final String childId;
  final double lat;
  final double lon;
  final double? accuracy;
  final DateTime? recordedAt;
  final int ageSec;

  factory FamilyLatestPoint.fromJson(Map<String, dynamic> json) => FamilyLatestPoint(
        childId: json['childId'] as String,
        lat: _double(json['lat']),
        lon: _double(json['lon']),
        accuracy: (json['accuracy'] as num?)?.toDouble(),
        recordedAt: _date(json['recordedAt']),
        ageSec: _int(json['ageSec']),
      );
}

/// `GET /geo/ip-center` — город по IP (DB-IP City Lite, CC BY 4.0).
@immutable
class IpCenter {
  const IpCenter({
    required this.lat,
    required this.lon,
    this.city,
    this.attribution = 'IP Geolocation by DB-IP',
  });

  final double lat;
  final double lon;
  final String? city;
  final String attribution;

  factory IpCenter.fromJson(Map<String, dynamic> json) => IpCenter(
        lat: _double(json['lat']),
        lon: _double(json['lon']),
        city: json['city'] as String?,
        attribution: (json['attribution'] as String?) ?? 'IP Geolocation by DB-IP',
      );
}
