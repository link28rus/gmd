import 'package:dio/dio.dart';

import '../api/api_exception.dart';
import '../api/dio_client.dart';
import '../storage/secure_storage_service.dart';
import 'auth_models.dart';

enum RefreshResult { refreshed, rejected, networkError }

/// Тонкая обёртка над `/auth/*` эндпоинтами + хранилищем токенов.
class AuthRepository {
  AuthRepository({
    required Dio dio,
    required SecureStorageService storage,
    required DioFactory dioFactory,
  })  : _dio = dio,
        _storage = storage {
    dioFactory.bindRefresh(_refresh);
  }

  final Dio _dio;
  final SecureStorageService _storage;

  /// Запросить OTP. Возможные исключения с code:
  /// `user_not_found`, `email_not_verified`, `account_blocked`, либо 429.
  Future<void> requestOtp(String email) async {
    await _dio.post<dynamic>(
      '/auth/request-otp',
      data: {'email': email},
      options: Options(extra: {'skipAuth': true}),
    );
  }

  /// Подтвердить OTP. Возвращает session или бросает ApiException
  /// с code `invalid_code` / `code_expired` / `code_consumed`.
  Future<AuthSession> verifyOtp({required String email, required String code}) async {
    final res = await _dio.post<dynamic>(
      '/auth/verify-otp',
      data: {'email': email, 'code': code},
      options: Options(extra: {'skipAuth': true}),
    );
    return _persistFromResponse(res.data as Map<String, dynamic>);
  }

  /// Логин по паролю. ApiException codes: `invalid_credentials`,
  /// `email_not_verified`, `account_blocked`, `account_locked`.
  Future<AuthSession> loginWithPassword({
    required String email,
    required String password,
  }) async {
    final res = await _dio.post<dynamic>(
      '/auth/login-password',
      data: {'email': email, 'password': password},
      options: Options(extra: {'skipAuth': true}),
    );
    return _persistFromResponse(res.data as Map<String, dynamic>);
  }

  /// Зарегистрировать аккаунт. На успех — 202 (требуется подтвердить email).
  Future<void> register({
    required String email,
    required String password,
    required String passwordConfirm,
    required String firstName,
    required String lastName,
    String? middleName,
    String? familyName,
  }) async {
    await _dio.post<dynamic>(
      '/auth/register',
      data: {
        'email': email,
        'password': password,
        'passwordConfirm': passwordConfirm,
        'firstName': firstName,
        'lastName': lastName,
        if (middleName != null && middleName.isNotEmpty) 'middleName': middleName,
        if (familyName != null && familyName.isNotEmpty) 'familyName': familyName,
      },
      options: Options(extra: {'skipAuth': true}),
    );
  }

  Future<void> logout() async {
    final refresh = await _storage.readRefreshToken();
    if (refresh != null && refresh.isNotEmpty) {
      try {
        await _dio.post<dynamic>(
          '/auth/logout',
          data: {'refreshToken': refresh},
          options: Options(extra: {'skipAuth': true}),
        );
      } on ApiException {
        // best-effort: всё равно очищаем локально
      } on DioException {
        // best-effort
      }
    }
    await _storage.clearAll();
  }

  /// Превентивный рефреш для splash-экрана. Возвращает:
  /// - `RefreshResult.refreshed` — успех, в storage свежий accessToken.
  /// - `RefreshResult.rejected` — сервер отклонил refresh-токен (expired/revoked),
  ///   storage уже почищен в `_refresh()`.
  /// - `RefreshResult.networkError` — оффлайн / 5xx / timeout. Storage не тронут,
  ///   старые токены остались — пускаем юзера на /home, interceptor разрулит.
  Future<RefreshResult> refreshSession() async {
    final hadRefresh = (await _storage.readRefreshToken())?.isNotEmpty ?? false;
    if (!hadRefresh) return RefreshResult.rejected;
    final ok = await _refresh();
    if (ok) return RefreshResult.refreshed;
    final stillHas = (await _storage.readRefreshToken())?.isNotEmpty ?? false;
    return stillHas ? RefreshResult.networkError : RefreshResult.rejected;
  }

  /// Внутренний рефреш — вызывается DioFactory при 401. Возвращает true,
  /// если access-токен обновлён.
  Future<bool> _refresh() async {
    final refresh = await _storage.readRefreshToken();
    if (refresh == null || refresh.isEmpty) return false;
    try {
      final res = await _dio.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': refresh},
        options: Options(extra: {'skipAuth': true, 'didRefresh': true}),
      );
      final data = res.data as Map<String, dynamic>;
      final newAccess = data['accessToken'] as String?;
      final newRefresh = data['refreshToken'] as String?;
      if (newAccess == null || newRefresh == null) return false;
      await _storage.saveAccessToken(newAccess);
      await _storage.saveRefreshToken(newRefresh);
      return true;
    } on ApiException {
      await _storage.clearAll();
      return false;
    } on DioException {
      return false;
    }
  }

  Future<AuthSession> _persistFromResponse(Map<String, dynamic> data) async {
    final accessToken = data['accessToken'] as String;
    // Refresh-токен бэкенд может не вернуть в verify-otp в некоторых сценариях —
    // тогда оставляем старый. Но в стандартном flow он всегда есть.
    final refreshToken =
        (data['refreshToken'] as String?) ?? (await _storage.readRefreshToken() ?? '');
    final userMap = data['user'] as Map<String, dynamic>;
    final familyMap = data['family'] as Map<String, dynamic>;

    await _storage.saveAccessToken(accessToken);
    if (refreshToken.isNotEmpty) await _storage.saveRefreshToken(refreshToken);
    await _storage.saveUser(userMap);
    await _storage.saveFamily(familyMap);

    return AuthSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      user: AuthUser.fromJson(userMap),
      family: AuthFamily.fromJson(familyMap),
    );
  }
}
