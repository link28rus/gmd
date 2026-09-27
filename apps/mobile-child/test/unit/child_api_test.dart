import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:periscop_child/core/api/child_api.dart';
import 'package:periscop_child/core/api/api_exceptions.dart';

class _MockDio extends Mock implements Dio {}

void main() {
  late _MockDio dio;
  late ChildApi api;

  setUpAll(() => registerFallbackValue(Options()));

  setUp(() {
    dio = _MockDio();
    api = ChildApi(dio);
  });

  test('claim returns ClaimResponse on 200', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/child/claim'),
        statusCode: 200,
        data: {
          'deviceToken': 'tok_123',
          'child': {'id': 'c1', 'name': 'Олег', 'familyId': 'f1'},
          'device': {'id': 'd1'},
        },
      ),
    );
    final r = await api.claim(
      code: '123456', deviceName: 'Pixel', osVersion: 'Android 14', appVersion: '0.13.0',
    );
    expect(r.deviceToken, 'tok_123');
    expect(r.childId, 'c1');
    expect(r.childName, 'Олег');
    expect(r.familyId, 'f1');
    expect(r.deviceId, 'd1');
  });

  test('claim throws InvalidCodeException on 404', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/claim'),
        response: Response(
          requestOptions: RequestOptions(path: '/child/claim'),
          statusCode: 404,
          data: {'code': 'invite_not_found'},
        ),
      ),
    );
    expect(
      () => api.claim(code: '000000', deviceName: 'x', osVersion: 'y', appVersion: 'z'),
      throwsA(isA<InvalidCodeException>()),
    );
  });

  test('claim throws InvalidCodeException on 410 (expired)', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/claim'),
        response: Response(
          requestOptions: RequestOptions(path: '/child/claim'),
          statusCode: 410, data: {'code': 'invite_expired'},
        ),
      ),
    );
    expect(
      () => api.claim(code: '111111', deviceName: 'x', osVersion: 'y', appVersion: 'z'),
      throwsA(isA<InvalidCodeException>()),
    );
  });

  void stubClaimError(int status, Object? data) {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/claim'),
        response: Response(
          requestOptions: RequestOptions(path: '/child/claim'),
          statusCode: status,
          data: data,
        ),
      ),
    );
  }

  Future<ClaimResponse> claimAny() =>
      api.claim(code: 'ZZZZ2222', deviceName: 'x', osVersion: 'y', appVersion: 'z');

  test('claim throws InvalidCodeException on 400 invite_invalid (реальный ответ бэкенда)',
      () async {
    stubClaimError(400, {
      'error': {'code': 'invite_invalid', 'message': 'Invite invalid'},
    });
    expect(claimAny, throwsA(isA<InvalidCodeException>()));
  });

  test('claim throws ChildHasDeviceException on 409 child_has_device', () async {
    stubClaimError(409, {
      'error': {'code': 'child_has_device', 'message': 'Child already has active device'},
    });
    expect(claimAny, throwsA(isA<ChildHasDeviceException>()));
  });

  test('claim throws Consent14PlusRequiredException on 400 consent14plus_required',
      () async {
    stubClaimError(400, {
      'error': {'code': 'consent14plus_required', 'message': 'consent'},
    });
    expect(claimAny, throwsA(isA<Consent14PlusRequiredException>()));
  });

  test('claim throws TooManyRequestsException on 429', () async {
    stubClaimError(429, {
      'error': {'code': 'too_many_requests', 'message': 'ThrottlerException'},
    });
    expect(claimAny, throwsA(isA<TooManyRequestsException>()));
  });

  test('claim throws ServerException on другой 400 (validation_error)', () async {
    stubClaimError(400, {
      'error': {'code': 'validation_error', 'message': 'bad'},
    });
    expect(claimAny, throwsA(isA<ServerException>()));
  });

  test('claim throws NetworkException when no response', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/claim'),
        type: DioExceptionType.connectionTimeout,
        message: 'connection timeout',
      ),
    );
    expect(
      () => api.claim(code: '123456', deviceName: 'x', osVersion: 'y', appVersion: 'z'),
      throwsA(isA<NetworkException>()),
    );
  });

  test('claim throws ServerException on 500', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/claim'),
        response: Response(
          requestOptions: RequestOptions(path: '/child/claim'),
          statusCode: 500, data: {},
        ),
      ),
    );
    expect(
      () => api.claim(code: '123456', deviceName: 'x', osVersion: 'y', appVersion: 'z'),
      throwsA(isA<ServerException>()),
    );
  });
}
