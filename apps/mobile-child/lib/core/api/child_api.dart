import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'api_exceptions.dart';

class ClaimResponse {
  ClaimResponse({
    required this.deviceToken,
    required this.childId,
    required this.childName,
    required this.familyId,
    required this.deviceId,
  });

  factory ClaimResponse.fromJson(Map<String, dynamic> json) {
    final child = json['child'] as Map<String, dynamic>;
    final device = json['device'] as Map<String, dynamic>;
    return ClaimResponse(
      deviceToken: json['deviceToken'] as String,
      childId: child['id'] as String,
      childName: child['name'] as String,
      familyId: child['familyId'] as String,
      deviceId: device['id'] as String,
    );
  }

  final String deviceToken;
  final String childId;
  final String childName;
  final String familyId;
  final String deviceId;
}

class ChildMeResult {
  const ChildMeResult({required this.tokenValid, this.familyName});

  final bool tokenValid;
  final String? familyName;
}

class LocationPoint {
  LocationPoint({
    required this.lat,
    required this.lon,
    required this.recordedAt,
    this.accuracy,
    this.altitude,
    this.speed,
    this.bearing,
    this.batteryLevel,
    this.isCharging,
    this.provider,
    this.networkType,
    this.wifiSsid,
    this.mobileOperator,
  });
  final double lat;
  final double lon;
  final double? accuracy;
  final double? altitude;
  final double? speed;
  final double? bearing;
  final int? batteryLevel;
  final bool? isCharging;
  final String? provider;
  final String? networkType;
  final String? wifiSsid;
  final String? mobileOperator;
  final DateTime recordedAt;

  Map<String, dynamic> toJson() => {
        'lat': lat,
        'lon': lon,
        if (accuracy != null) 'accuracy': accuracy,
        if (altitude != null) 'altitude': altitude,
        if (speed != null) 'speed': speed,
        if (bearing != null) 'bearing': bearing,
        if (batteryLevel != null) 'batteryLevel': batteryLevel,
        if (isCharging != null) 'isCharging': isCharging,
        if (provider != null) 'provider': provider,
        if (networkType != null) 'networkType': networkType,
        if (wifiSsid != null) 'wifiSsid': wifiSsid,
        if (mobileOperator != null) 'mobileOperator': mobileOperator,
        'recordedAt': recordedAt.toUtc().toIso8601String(),
      };
}

class IngestResponse {
  IngestResponse({required this.acceptedIds, required this.rejectedIds});
  final List<int> acceptedIds;
  final List<int> rejectedIds;
}

class SosResponse {
  SosResponse({required this.sosId, required this.createdAt});

  factory SosResponse.fromJson(Map<String, dynamic> json) => SosResponse(
        sosId: json['sosId'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  final String sosId;
  final DateTime createdAt;
}

class DeviceCommand {
  DeviceCommand({
    required this.id,
    required this.type,
    this.payload,
  });

  factory DeviceCommand.fromJson(Map<String, dynamic> json) => DeviceCommand(
        id: json['id'] as String,
        type: json['type'] as String,
        payload: json['payload'] as Map<String, dynamic>?,
      );

  final String id;
  final String type;
  final Map<String, dynamic>? payload;
}

class ChildApi {
  ChildApi(this._dio);
  final Dio _dio;

  Future<ClaimResponse> claim({
    required String code,
    required String deviceName,
    required String osVersion,
    required String appVersion,
    bool consent14Plus = false,
  }) async {
    try {
      final resp = await _dio.post('/child/claim', data: {
        'code': code,
        'deviceName': deviceName,
        'osVersion': osVersion,
        'appVersion': appVersion,
        'consent14Plus': consent14Plus,
      });
      return ClaimResponse.fromJson(resp.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 404 || status == 410) throw const InvalidCodeException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }

  Future<IngestResponse> ingestLocations(
    List<LocationPoint> points, {
    required String deviceToken,
  }) async {
    try {
      await _dio.post(
        '/child/locations',
        data: {'points': points.map((p) => p.toJson()).toList()},
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      return IngestResponse(acceptedIds: const [], rejectedIds: const []);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        throw const UnauthorizedException();
      }
      if (status != null && status >= 400 && status < 500) {
        throw const BadRequestIngestException();
      }
      throw NetworkException(e.message ?? 'Network');
    }
  }

  // Проверка валидности текущего deviceToken + получение family.name
  // (нужно home-экрану чтобы показать «Ты подключён к семье <Имя>»).
  // tokenValid=true если токен живой, false — 401/403 (устройство отвязано).
  // При сетевой ошибке tokenValid=true (не знаем статус, не дёргаем
  // пользователя зря — подтянем при реальном ingest), familyName=null.
  Future<ChildMeResult> fetchMe(String deviceToken) async {
    try {
      final resp = await _dio.get(
        '/child/me',
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      final data = resp.data as Map<String, dynamic>?;
      final family = data?['family'] as Map<String, dynamic>?;
      return ChildMeResult(
        tokenValid: true,
        familyName: family?['name'] as String?,
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        return const ChildMeResult(tokenValid: false);
      }
      return const ChildMeResult(tokenValid: true);
    }
  }

  // Забрать pending-команды для этого устройства. Используется ingestor'ом
  // после flushQueue — так команды доставляются в пределах 2 минут
  // (heartbeat-интервал) без отдельного поллинга.
  Future<List<DeviceCommand>> getPendingCommands({
    required String deviceToken,
  }) async {
    try {
      final resp = await _dio.get(
        '/child/commands/pending',
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      final list = ((resp.data as Map<String, dynamic>)['commands'] as List)
          .cast<Map<String, dynamic>>();
      return list.map(DeviceCommand.fromJson).toList();
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }

  // Подтвердить выполнение команды. Идемпотентно (сервер не ругается на
  // повторный ack).
  Future<void> ackCommand({
    required String deviceToken,
    required String commandId,
  }) async {
    try {
      await _dio.post(
        '/child/commands/$commandId/ack',
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }

  // Protection-state: нужен ли Device Admin. Вызывается при старте home-экрана
   // и перед heartbeat (в background-изоляте не нужен — protection UI только в
   // foreground). Ошибки сети → null, UI тогда оставляет статус как есть.
  Future<bool?> getProtection({required String deviceToken}) async {
    try {
      final resp = await _dio.get(
        '/child/protection',
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      final data = resp.data as Map<String, dynamic>;
      return data['enabled'] as bool;
    } on DioException catch (_) {
      return null;
    }
  }

  Future<SosResponse> sendSos({
    required String deviceToken,
    required double lat,
    required double lon,
    required DateTime recordedAt,
    double? accuracy,
    String? message,
  }) async {
    try {
      final resp = await _dio.post(
        '/sos',
        data: {
          'lat': lat,
          'lon': lon,
          'accuracy': ?accuracy,
          'recordedAt': recordedAt.toUtc().toIso8601String(),
          'message': ?message,
        },
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      return SosResponse.fromJson(resp.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 429) throw const TooManyRequestsException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }

  // v0.37: регистрируем FCM token в backend для high-priority push доставки
  // команд (мгновенный START_AUDIO/STOP_AUDIO без 60-120с poll latency).
  // null = устройство сделало FirebaseInstanceId.delete() (rare); backend
  // в этом случае автоматически fallback'ится на poll-команды.
  Future<void> setFcmToken({
    required String? fcmToken,
    required String deviceToken,
  }) async {
    try {
      await _dio.post(
        '/child/devices/fcm-token',
        data: {'fcmToken': fcmToken},
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        throw const UnauthorizedException();
      }
      throw NetworkException(e.message ?? 'Network');
    }
  }

  // v0.51 RuStore Push (lesson #24): параллельный канал для устройств без GMS
  // и для bypass MIUI Restricted Settings. Backend хранит rustorePushToken
  // отдельно от fcmToken; при отправке предпочитает RuStore (он не сбрасывается
  // при sideload-update). null = устройство потеряло RuStore client / удалило
  // токен — backend очищает запись.
  Future<void> setRustorePushToken({
    required String? rustorePushToken,
    required String deviceToken,
  }) async {
    try {
      await _dio.post(
        '/child/devices/rustore-token',
        data: {'rustorePushToken': rustorePushToken},
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        throw const UnauthorizedException();
      }
      throw NetworkException(e.message ?? 'Network');
    }
  }

  // ─── v0.38 Phase 6.1: screen-time reporting ─────────────────────────────

  /// POST snapshot установленных apps + IANA timezone.
  /// Возвращает список sha256 иконок, которых backend ещё НЕ имеет —
  /// caller должен залить их через [postAppIcons].
  ///
  /// `apps` — каждый элемент это Map с ключами:
  /// `packageName`, `appLabel`, `isSystem`, `iconSha256` (опционально).
  Future<List<String>> postInstalledApps({
    required String deviceToken,
    required String timezone,
    required List<Map<String, dynamic>> apps,
  }) async {
    try {
      final resp = await _dio.post(
        '/child/installed-apps',
        data: {'timezone': timezone, 'apps': apps},
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      final data = resp.data as Map<String, dynamic>;
      final missing = (data['missingIconSha256'] as List?)?.cast<String>() ?? const [];
      return missing;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Network');
      throw ServerException('Ошибка сервера', status);
    }
  }

  /// POST батч иконок. Каждый элемент `icons` — `{sha256, pngBytes}`.
  /// Backend проверяет sha256 на соответствие байтам + PNG magic bytes.
  ///
  /// Лимит — 50 иконок на batch (соответствует backend AppIconsBodySchema).
  /// Возвращает {uploaded, skipped} счётчики.
  Future<({int uploaded, int skipped})> postAppIcons({
    required String deviceToken,
    required List<({String sha256, Uint8List pngBytes})> icons,
  }) async {
    assert(icons.length <= 50, 'max 50 icons per batch');
    final payload = icons
        .map((i) => {
              'sha256': i.sha256,
              'pngBase64': base64Encode(i.pngBytes),
            })
        .toList(growable: false);
    try {
      final resp = await _dio.post(
        '/child/app-icons',
        data: {'icons': payload},
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      final data = resp.data as Map<String, dynamic>;
      return (
        uploaded: (data['uploaded'] as num?)?.toInt() ?? 0,
        skipped: (data['skipped'] as num?)?.toInt() ?? 0,
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Network');
      throw ServerException('Ошибка сервера', status);
    }
  }

  /// POST часовых usage-bucket'ов.
  /// `buckets` — список Map'ов с ключами `date` (YYYY-MM-DD), `hour` (0..23),
  /// `packageName`, `seconds`.
  ///
  /// Backend UPSERT'ит — replace, не add (см. семантику в backend DTO).
  Future<void> postUsageReport({
    required String deviceToken,
    required String timezone,
    required List<Map<String, dynamic>> buckets,
  }) async {
    if (buckets.isEmpty) return; // backend требует min 1, тривиальный no-op
    try {
      await _dio.post(
        '/child/usage-reports',
        data: {'timezone': timezone, 'buckets': buckets},
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Network');
      throw ServerException('Ошибка сервера', status);
    }
  }
}
