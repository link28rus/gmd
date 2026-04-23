import 'package:dio/dio.dart';
import 'api_exceptions.dart';

/// REST-клиент для /child/audio/sessions/* endpoints
/// (Phase 5.3 — «Звук вокруг ребёнка»).
///
/// Все методы требуют [deviceToken] (X-Child-Token header) и [sessionId].
/// Ошибки маппятся аналогично [ChildApi]:
///   401/403 → [UnauthorizedException]
///   5xx/без сети → [ServerException] / [NetworkException]
class AudioApi {
  AudioApi(this._dio);
  final Dio _dio;

  /// Отправить SDP-offer от child → backend переводит сессию PENDING → READY.
  Future<void> sendReady({
    required String sessionId,
    required String deviceToken,
    required String sdp,
  }) async {
    await _post(
      '/child/audio/sessions/$sessionId/ready',
      deviceToken,
      {'sdp': sdp},
    );
  }

  /// Отправить ICE-candidate от child.
  Future<void> sendIce({
    required String sessionId,
    required String deviceToken,
    required String candidate,
  }) async {
    await _post(
      '/child/audio/sessions/$sessionId/ice',
      deviceToken,
      {'candidate': candidate},
    );
  }

  /// Сообщить backend об ошибке (PERMISSION_DENIED / MIC_BUSY / OEM_BLOCKED /
  /// NETWORK_ERROR / UNKNOWN). Backend помечает сессию FAILED.
  /// Поле [message] опциональное — не включается в тело если null.
  Future<void> sendError({
    required String sessionId,
    required String deviceToken,
    required String code,
    String? message,
  }) async {
    final body = <String, dynamic>{'code': code};
    if (message != null) body['message'] = message;
    await _post('/child/audio/sessions/$sessionId/error', deviceToken, body);
  }

  Future<void> _post(
    String path,
    String token,
    Map<String, dynamic> body,
  ) async {
    try {
      await _dio.post(
        path,
        data: body,
        options: Options(headers: {'X-Child-Token': token}),
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }
}
