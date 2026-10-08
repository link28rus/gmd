import 'package:dio/dio.dart';

import '../zones/zone_format.dart' show apiExceptionOf;

/// v0.72.0: согласие с политикой конфиденциальности и условиями
/// (docs/superpowers/specs/2026-10-08-family-members.md, раздел «v0.72.0»).
///
/// Участник, которому аккаунт завёл владелец семьи, политику ещё не принимал:
/// чтение работает, изменения отвечают 403 `consent_required`. То же — у всех
/// после смены версии политики на сервере.

/// Поля согласия из `GET /me`.
class MeConsentInfo {
  const MeConsentInfo({required this.requiresConsent, this.currentPolicyVersion});

  final bool requiresConsent;
  final String? currentPolicyVersion;

  /// Из ответа `GET /me` (поля верхнего уровня, рядом с `user`/`family`).
  /// Нет поля или не bool → согласие не требуется: экран не должен
  /// блокировать вход из-за неожиданного ответа.
  factory MeConsentInfo.fromMeJson(Object? json) {
    if (json is! Map) return const MeConsentInfo(requiresConsent: false);
    final version = json['currentPolicyVersion'];
    return MeConsentInfo(
      requiresConsent: json['requiresConsent'] == true,
      currentPolicyVersion: version is String ? version : null,
    );
  }
}

/// Ошибка — «нужно принять политику» (403 `consent_required`).
bool isConsentRequiredError(Object e) => apiExceptionOf(e)?.code == 'consent_required';

class ConsentRepository {
  ConsentRepository(this._dio);

  final Dio _dio;

  /// `GET /me` → поля согласия.
  Future<MeConsentInfo> fetch() async {
    final res = await _dio.get<dynamic>('/me');
    return MeConsentInfo.fromMeJson(res.data);
  }

  /// `POST /me/consent` → 204. 400 `consent_already_accepted` (принято, например,
  /// в веб-кабинете) — тоже успех.
  Future<void> accept() async {
    try {
      await _dio.post<dynamic>(
        '/me/consent',
        data: {
          'documents': ['PRIVACY_POLICY', 'TERMS_OF_USE'],
        },
      );
    } catch (e) {
      if (apiExceptionOf(e)?.code == 'consent_already_accepted') return;
      rethrow;
    }
  }
}
