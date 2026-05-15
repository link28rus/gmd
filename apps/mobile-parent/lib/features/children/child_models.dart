/// Модель ребёнка из `GET /family/children` (см. children.controller.ts).
class Child {
  Child({
    required this.id,
    required this.name,
    this.dateOfBirth,
    this.protectionEnabled = false,
    this.device,
  });

  final String id;
  final String name;
  final DateTime? dateOfBirth;
  final bool protectionEnabled;
  final ChildDevice? device;

  factory Child.fromJson(Map<String, dynamic> json) {
    return Child(
      id: json['id'] as String,
      name: json['name'] as String,
      dateOfBirth: _parseDate(json['dateOfBirth']),
      protectionEnabled: (json['protectionEnabled'] as bool?) ?? false,
      device: json['device'] is Map<String, dynamic>
          ? ChildDevice.fromJson(json['device'] as Map<String, dynamic>)
          : null,
    );
  }

  /// Активен ли девайс ребёнка: токен не отозван и виделся не позже часа назад.
  bool get isOnline {
    final d = device;
    if (d == null || d.revokedAt != null) return false;
    final last = d.lastSeenAt;
    if (last == null) return false;
    return DateTime.now().difference(last).inMinutes < 60;
  }
}

class ChildDevice {
  ChildDevice({
    required this.id,
    this.deviceName,
    this.osVersion,
    this.appVersion,
    this.lastSeenAt,
    this.revokedAt,
  });

  final String id;
  final String? deviceName;
  final String? osVersion;
  final String? appVersion;
  final DateTime? lastSeenAt;
  final DateTime? revokedAt;

  factory ChildDevice.fromJson(Map<String, dynamic> json) => ChildDevice(
        id: json['id'] as String,
        deviceName: json['deviceName'] as String?,
        osVersion: json['osVersion'] as String?,
        appVersion: json['appVersion'] as String?,
        lastSeenAt: _parseDate(json['lastSeenAt']),
        revokedAt: _parseDate(json['revokedAt']),
      );
}

/// Источник определения координат — поле `provider` в `LocationDto`.
/// Backend пишет строку 'gps' / 'fused' / 'network' (см. mobile-child
/// FusedLocationProvider). На UI нам нужны только три варианта.
enum LocationProvider { gps, fused, network, unknown }

LocationProvider _parseProvider(Object? raw) {
  if (raw is! String) return LocationProvider.unknown;
  switch (raw.toLowerCase()) {
    case 'gps':
      return LocationProvider.gps;
    case 'fused':
      return LocationProvider.fused;
    case 'network':
      return LocationProvider.network;
    default:
      return LocationProvider.unknown;
  }
}

/// Тип подключения к сети — поле `networkType`.
enum NetworkType { wifi, mobile, offline, unknown }

NetworkType _parseNetwork(Object? raw) {
  if (raw is! String) return NetworkType.unknown;
  switch (raw.toLowerCase()) {
    case 'wifi':
      return NetworkType.wifi;
    case 'mobile':
      return NetworkType.mobile;
    case 'offline':
      return NetworkType.offline;
    default:
      return NetworkType.unknown;
  }
}

/// Точка локации `GET /children/:id/location/latest`.
///
/// Бэкенд (`apps/backend/src/locations/locations.service.ts` `LocationDto`)
/// отдаёт расширенный набор метрик — батарея, точность, провайдер, тип
/// сети, оператор. `ageSec` добавляется только в `getLatest` (для других
/// списков точек его нет).
class ChildLocation {
  ChildLocation({
    required this.lat,
    required this.lon,
    required this.recordedAt,
    this.accuracy,
    this.batteryLevel,
    this.isCharging,
    this.speed,
    this.provider = LocationProvider.unknown,
    this.networkType = NetworkType.unknown,
    this.wifiSsid,
    this.mobileOperator,
    this.ageSec,
  });

  final double lat;
  final double lon;
  final DateTime recordedAt;
  final double? accuracy;

  /// Заряд батареи устройства ребёнка, %. Backend поле `batteryLevel`.
  /// (До v0.50.0 модель читала `json['battery']` — это был баг, поле
  /// всегда возвращало null.)
  final int? batteryLevel;

  /// Заряжается ли устройство сейчас.
  final bool? isCharging;

  /// Скорость в м/с (для активного трека).
  final double? speed;

  /// Источник геолокации — gps/fused/network.
  final LocationProvider provider;

  /// Wi-Fi / mobile / offline / unknown.
  final NetworkType networkType;

  /// Имя Wi-Fi сети (если есть и устройство поделилось).
  final String? wifiSsid;

  /// Имя мобильного оператора (если networkType == mobile).
  final String? mobileOperator;

  /// Сколько секунд назад был зафиксирован last point. Только для
  /// `latest-location` endpoint, иначе null.
  final int? ageSec;

  /// Удобный getter — Duration с момента последней точки. Если backend
  /// не вернул `ageSec`, считаем по `recordedAt`.
  Duration get age {
    if (ageSec != null) return Duration(seconds: ageSec!);
    return DateTime.now().difference(recordedAt);
  }

  factory ChildLocation.fromJson(Map<String, dynamic> json) => ChildLocation(
        lat: (json['lat'] as num).toDouble(),
        lon: (json['lon'] as num).toDouble(),
        recordedAt: DateTime.parse(json['recordedAt'] as String).toLocal(),
        accuracy: (json['accuracy'] as num?)?.toDouble(),
        batteryLevel: json['batteryLevel'] as int?,
        isCharging: json['isCharging'] as bool?,
        speed: (json['speed'] as num?)?.toDouble(),
        provider: _parseProvider(json['provider']),
        networkType: _parseNetwork(json['networkType']),
        wifiSsid: json['wifiSsid'] as String?,
        mobileOperator: json['mobileOperator'] as String?,
        ageSec: json['ageSec'] as int?,
      );
}

DateTime? _parseDate(Object? raw) {
  if (raw is String && raw.isNotEmpty) return DateTime.parse(raw).toLocal();
  return null;
}

/// Ответ `POST /family/children/:childId/invites`.
///
/// `qrUrl` — то, что кладётся в QR-код (формат `${landingBaseUrl}/claim/${code}`,
/// например `https://gmd-online.ru/claim/AB12CD`). mobile-child сканирует
/// QR, парсит URL → извлекает `code` → дёргает `/invites/claim` с device-info.
///
/// `deepLink` — альтернатива QR (gmd://claim/AB12CD), для ручного ввода
/// или нативного intent-открытия. Не используется в mobile-parent UI.
class InviteResponse {
  InviteResponse({
    required this.code,
    required this.qrUrl,
    required this.deepLink,
    required this.expiresIn,
  });

  /// 6-символьный код привязки (формат `[A-Z0-9]{6}`).
  final String code;

  /// Полный URL для QR-кода.
  final String qrUrl;

  /// Deep-link для нативного launch (`gmd://claim/<code>`).
  final String deepLink;

  /// Сколько секунд ещё действителен код (обычно 600 = 10 минут).
  final int expiresIn;

  DateTime get expiresAt => DateTime.now().add(Duration(seconds: expiresIn));
}
