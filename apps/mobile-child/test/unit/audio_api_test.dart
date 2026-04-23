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

  group('AudioApi.sendReady', () {
    test('POST /child/audio/sessions/:id/ready with sdp body and X-Child-Token header', () async {
      when(
        () => dio.post(
          '/child/audio/sessions/sess_abc/ready',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/child/audio/sessions/sess_abc/ready'),
          statusCode: 204,
        ),
      );

      await api.sendReady(
        sessionId: 'sess_abc',
        deviceToken: 'tok_123',
        sdp: 'v=0\r\n...',
      );

      final captured = verify(
        () => dio.post(
          '/child/audio/sessions/sess_abc/ready',
          data: captureAny(named: 'data'),
          options: captureAny(named: 'options'),
        ),
      ).captured;

      final body = captured[0] as Map<String, dynamic>;
      final opts = captured[1] as Options;

      expect(body['sdp'], 'v=0\r\n...');
      expect(opts.headers?['X-Child-Token'], 'tok_123');
    });

    test('sendReady throws UnauthorizedException on 401', () async {
      when(
        () => dio.post(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/ready'),
          response: Response(
            requestOptions: RequestOptions(path: '/child/audio/sessions/s1/ready'),
            statusCode: 401,
          ),
        ),
      );

      expect(
        () => api.sendReady(sessionId: 's1', deviceToken: 'bad', sdp: 'v=0'),
        throwsA(isA<UnauthorizedException>()),
      );
    });
  });

  group('AudioApi.sendIce', () {
    test('POST /child/audio/sessions/:id/ice with candidate body and X-Child-Token header', () async {
      when(
        () => dio.post(
          '/child/audio/sessions/sess_xyz/ice',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/child/audio/sessions/sess_xyz/ice'),
          statusCode: 204,
        ),
      );

      await api.sendIce(
        sessionId: 'sess_xyz',
        deviceToken: 'tok_456',
        candidate: 'candidate:0 1 UDP 2122252543 ...',
      );

      final captured = verify(
        () => dio.post(
          '/child/audio/sessions/sess_xyz/ice',
          data: captureAny(named: 'data'),
          options: captureAny(named: 'options'),
        ),
      ).captured;

      final body = captured[0] as Map<String, dynamic>;
      final opts = captured[1] as Options;

      expect(body['candidate'], 'candidate:0 1 UDP 2122252543 ...');
      expect(opts.headers?['X-Child-Token'], 'tok_456');
    });
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
      expect(body['code'], 'PERMISSION_DENIED');
      expect(body['message'], 'Микрофон недоступен');
    });

    test('POST /child/audio/sessions/:id/error without message — no message key', () async {
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
    test('throws UnauthorizedException on 403', () async {
      when(
        () => dio.post(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/ice'),
          response: Response(
            requestOptions: RequestOptions(path: '/child/audio/sessions/s1/ice'),
            statusCode: 403,
          ),
        ),
      );

      expect(
        () => api.sendIce(sessionId: 's1', deviceToken: 'bad', candidate: 'cand'),
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
          requestOptions: RequestOptions(path: '/child/audio/sessions/s1/ready'),
          response: Response(
            requestOptions: RequestOptions(path: '/child/audio/sessions/s1/ready'),
            statusCode: 500,
            data: {},
          ),
        ),
      );

      expect(
        () => api.sendReady(sessionId: 's1', deviceToken: 'tok', sdp: 'v=0'),
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
