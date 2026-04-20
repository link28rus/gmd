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
}
