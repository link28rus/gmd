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

  // Проверка валидности текущего deviceToken. Возвращает true если токен
  // живой, false — если сервер вернул 401/403 (устройство отвязано). При
  // сетевой ошибке возвращает true (не знаем статус, не дёргаем пользователя
  // зря — подтянем при реальном ingest).
  Future<bool> verifyToken(String deviceToken) async {
    try {
      await _dio.get(
        '/child/me',
        options: Options(headers: {'X-Child-Token': deviceToken}),
      );
      return true;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) return false;
      // Network / 5xx — токен может быть валиден, не удаляем.
      return true;
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
}
