import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:gmd_child/core/api/audio_api.dart';
import 'package:gmd_child/core/api/api_exceptions.dart';

class _MockDio extends Mock implements Dio {}

void main() {
  late _MockDio dio;
  late AudioApi api;

  setUpAll(() => registerFallbackValue(Options()));

  setUp(() {
    dio = _MockDio();
    api = AudioApi(dio);
  });

  group('AudioApi.sendError', () {
    test('POST /child/audio/sessions/:id/error with code and message', () async {
      when(
        () => dio.post(
          '/child/audio/sessions/sess_err/error',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/child/audio/sessions/sess_err/error'),
          statusCode: 204,
        ),
      );

      await api.sendError(
        sessionId: 'sess_err',
        deviceToken: 'tok_789',
        code: 'PERMISSION_DENIED',
        message: 'Микрофон недоступен',
      );

      final captured = verify(
        () => dio.post(
          '/child/audio/sessions/sess_err/error',
          data: captureAny(named: 'data'),
          options: captureAny(named: 'options'),
        ),
      ).captured;

      final body = captured[0] as Map<String, dynamic>;
      final opts = captured[1] as Options;
      expect(body['code'], 'PERMISSION_DENIED');
      expect(body['message'], 'Микрофон недоступен');
      expect(opts.headers?['X-Child-Token'], 'tok_789');
    });

    test('POST /:id/error without message — no message key', () async {
      when(
        () => dio.post(
          '/child/audio/sessions/sess_err2/error',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/child/audio/sessions/sess_err2/error'),
          statusCode: 204,
        ),
      );

      await api.sendError(
        sessionId: 'sess_err2',
        deviceToken: 'tok_789',
        code: 'MIC_BUSY',
      );

      final captured = verify(
        () => dio.post(
          '/child/audio/sessions/sess_err2/error',
          data: captureAny(named: 'data'),
          options: captureAny(named: 'options'),
        ),
      ).captured;

      final body = captured[0] as Map<String, dynamic>;
      expect(body['code'], 'MIC_BUSY');
      expect(body.containsKey('message'), isFalse);
    });
  });

  group('AudioApi error handling', () {
    test('throws UnauthorizedException on 401', () async {
      when(
        () => dio.post(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
          response: Response(
            requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
            statusCode: 401,
          ),
        ),
      );

      expect(
        () => api.sendError(sessionId: 's1', deviceToken: 'bad', code: 'UNKNOWN'),
        throwsA(isA<UnauthorizedException>()),
      );
    });

    test('throws UnauthorizedException on 403', () async {
      when(
        () => dio.post(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
          response: Response(
            requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
            statusCode: 403,
          ),
        ),
      );

      expect(
        () => api.sendError(sessionId: 's1', deviceToken: 'bad', code: 'UNKNOWN'),
        throwsA(isA<UnauthorizedException>()),
      );
    });

    test('throws ServerException on 500', () async {
      when(
        () => dio.post(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
          response: Response(
            requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
            statusCode: 500,
            data: {},
          ),
        ),
      );

      expect(
        () => api.sendError(sessionId: 's1', deviceToken: 'tok', code: 'UNKNOWN'),
        throwsA(isA<ServerException>()),
      );
    });

    test('throws NetworkException when no response (connection timeout)', () async {
      when(
        () => dio.post(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/error'),
          type: DioExceptionType.connectionTimeout,
          message: 'connection timeout',
        ),
      );

      expect(
        () => api.sendError(sessionId: 's1', deviceToken: 'tok', code: 'NETWORK_ERROR'),
        throwsA(isA<NetworkException>()),
      );
    });
  });
}
