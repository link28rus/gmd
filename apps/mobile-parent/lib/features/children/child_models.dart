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

/// Точка локации `GET /children/:id/location/latest`.
class ChildLocation {
  ChildLocation({
    required this.lat,
    required this.lon,
    required this.recordedAt,
    this.accuracy,
    this.battery,
    this.speed,
  });

  final double lat;
  final double lon;
  final DateTime recordedAt;
  final double? accuracy;
  final int? battery;
  final double? speed;

  factory ChildLocation.fromJson(Map<String, dynamic> json) => ChildLocation(
        lat: (json['lat'] as num).toDouble(),
        lon: (json['lon'] as num).toDouble(),
        recordedAt: DateTime.parse(json['recordedAt'] as String).toLocal(),
        accuracy: (json['accuracy'] as num?)?.toDouble(),
        battery: json['battery'] as int?,
        speed: (json['speed'] as num?)?.toDouble(),
      );
}

DateTime? _parseDate(Object? raw) {
  if (raw is String && raw.isNotEmpty) return DateTime.parse(raw).toLocal();
  return null;
}
