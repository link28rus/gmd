import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/core/api/api_exception.dart';
import 'package:periscop_parent/features/consent/consent_repository.dart';

void main() {
  group('MeConsentInfo.fromMeJson (GET /me)', () {
    test('requiresConsent true + версия', () {
      final info = MeConsentInfo.fromMeJson({
        'user': {'id': 'u1', 'email': 'a@b.ru'},
        'family': {'id': 'f1', 'name': 'Ивановы'},
        'requiresConsent': true,
        'currentPolicyVersion': '2026-10-01',
      });
      expect(info.requiresConsent, isTrue);
      expect(info.currentPolicyVersion, '2026-10-01');
    });

    test('requiresConsent false', () {
      final info = MeConsentInfo.fromMeJson({'requiresConsent': false});
      expect(info.requiresConsent, isFalse);
    });

    test('нет поля / не bool / не объект → не требуется (не блокируем вход)', () {
      expect(MeConsentInfo.fromMeJson(<String, dynamic>{}).requiresConsent, isFalse);
      expect(MeConsentInfo.fromMeJson({'requiresConsent': 'true'}).requiresConsent, isFalse);
      expect(MeConsentInfo.fromMeJson(null).requiresConsent, isFalse);
      expect(MeConsentInfo.fromMeJson('oops').requiresConsent, isFalse);
    });
  });

  test('isConsentRequiredError', () {
    DioException err(String code) => DioException(
      requestOptions: RequestOptions(path: '/x'),
      error: ApiException(status: 403, code: code),
      type: DioExceptionType.badResponse,
    );
    expect(isConsentRequiredError(err('consent_required')), isTrue);
    expect(isConsentRequiredError(err('forbidden')), isFalse);
    expect(isConsentRequiredError(Exception('net')), isFalse);
  });
}
