import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/secure_storage_service.dart';
import 'api_exception.dart';

typedef RefreshFn = Future<bool> Function();

/// Базовый Dio с двумя интерсепторами:
/// 1. AuthInterceptor — автоматически подставляет `Authorization: Bearer …` из storage.
/// 2. RefreshInterceptor — на 401 пытается рефрешнуть токен и повторить запрос
///    один раз. Если рефреш не удался — кидает ApiException(401).
class DioFactory {
  DioFactory(this._storage);

  final SecureStorageService _storage;

  /// Колбэк рефреша устанавливается AuthRepository (чтобы избежать циклической
  /// зависимости storage ↔ api).
  RefreshFn? _refresh;

  void bindRefresh(RefreshFn fn) {
    _refresh = fn;
  }

  Dio build() {
    final dio = Dio(
      BaseOptions(
        baseUrl: apiBaseUrl,
        connectTimeout: const Duration(seconds: 10),
        sendTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          // Заставляет web /api/auth/* возвращать refreshToken в response body
          // (а не только класть в HttpOnly cookie, как для browser-flow).
          // Без этого mobile теряет refresh при перезапуске → юзера выкидывает на /login.
          'X-Client': 'mobile-parent',
        },
        // Не бросаем исключение на 4xx — обрабатываем сами в интерсепторе ниже.
        validateStatus: (s) => s != null && s < 500,
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['skipAuth'] != true) {
            final token = await _storage.readAccessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          handler.next(options);
        },
        onResponse: (response, handler) async {
          final status = response.statusCode ?? 0;
          if (status == 401 &&
              response.requestOptions.extra['didRefresh'] != true &&
              _refresh != null) {
            final ok = await _refresh!();
            if (ok) {
              final newOpts = response.requestOptions.copyWith(
                extra: {...response.requestOptions.extra, 'didRefresh': true},
              );
              final token = await _storage.readAccessToken();
              if (token != null) {
                newOpts.headers['Authorization'] = 'Bearer $token';
              }
              try {
                final retried = await dio.fetch(newOpts);
                return handler.resolve(retried);
              } on DioException catch (e) {
                if (e.response != null) return handler.resolve(e.response!);
                rethrow;
              }
            }
          }
          if (status >= 400) {
            return handler.reject(
              DioException(
                requestOptions: response.requestOptions,
                response: response,
                error: _toApiException(response),
                type: DioExceptionType.badResponse,
              ),
            );
          }
          handler.next(response);
        },
      ),
    );

    return dio;
  }
}

ApiException _toApiException(Response<dynamic> response) {
  final data = response.data;
  String? code;
  String? message;
  if (data is Map) {
    final err = data['error'];
    if (err is Map) {
      final errCode = err['code'];
      final errMsg = err['message'];
      if (errCode is String) code = errCode;
      if (errMsg is String) message = errMsg;
    } else {
      final dataCode = data['code'];
      final dataMsg = data['message'];
      if (dataCode is String) code = dataCode;
      if (dataMsg is String) message = dataMsg;
    }
  }
  return ApiException(
    status: response.statusCode ?? 0,
    code: code,
    message: message,
  );
}
