import 'package:dio/dio.dart';

/// API геолокации родителя (v0.70.0, спека 2026-10-08-family-map-parent-location).
/// Все вызовы — под JWT родителя. Точки отправляет не Dart, а нативная служба
/// (`ParentLocationUploader.kt`) со своим долгоживущим токеном.
class ParentLocationRepository {
  ParentLocationRepository(this._dio);

  final Dio _dio;

  /// `POST /parent-location/devices` → `201 { deviceId, token }`.
  /// [replaceDeviceId] — своё прежнее устройство, сервер его отзовёт.
  Future<({String deviceId, String token})> registerDevice({
    String? platform,
    String? appVersion,
    String? replaceDeviceId,
  }) async {
    final res = await _dio.post<dynamic>(
      '/parent-location/devices',
      data: <String, dynamic>{
        'platform': ?platform,
        'appVersion': ?appVersion,
        'replaceDeviceId': ?replaceDeviceId,
      },
    );
    final data = res.data;
    final deviceId = data is Map ? data['deviceId'] : null;
    final token = data is Map ? data['token'] : null;
    if (deviceId is! String || token is! String || deviceId.isEmpty || token.isEmpty) {
      throw const FormatException('parent-location/devices: нет deviceId/token в ответе');
    }
    return (deviceId: deviceId, token: token);
  }

  /// `DELETE /parent-location/devices/:deviceId` → 204 (только своё).
  Future<void> deleteDevice(String deviceId) async {
    await _dio.delete<dynamic>('/parent-location/devices/${Uri.encodeComponent(deviceId)}');
  }

  /// `GET /parent-location/sharing` → `{ enabled }`.
  Future<bool> getSharing() async {
    final res = await _dio.get<dynamic>('/parent-location/sharing');
    return _enabled(res.data);
  }

  /// `PUT /parent-location/sharing` `{ enabled }` → `{ enabled }`. `false`
  /// заодно удаляет с сервера все точки пользователя.
  Future<bool> setSharing(bool enabled) async {
    final res = await _dio.put<dynamic>('/parent-location/sharing', data: {'enabled': enabled});
    return _enabled(res.data, fallback: enabled);
  }

  static bool _enabled(Object? data, {bool? fallback}) {
    final v = data is Map ? data['enabled'] : null;
    if (v is bool) return v;
    if (fallback != null) return fallback;
    throw const FormatException('parent-location/sharing: нет enabled в ответе');
  }
}
