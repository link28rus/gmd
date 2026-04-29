import 'dart:io' show SocketException;

import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/foundation.dart';

import '../config/env.dart';
import '../storage/secure_storage_service.dart';
import 'api_exception.dart';

typedef RefreshFn = Future<bool> Function();

/// Базовый Dio с тремя интерсепторами:
/// 1. AuthInterceptor — автоматически подставляет `Authorization: Bearer …` из storage.
/// 2. RefreshInterceptor — на 401 пытается рефрешнуть токен и повторить запрос
///    один раз. Если рефреш не удался — кидает ApiException(401).
/// 3. ConnectionRetryInterceptor — на `connectionError` / `SocketException`
///    (типичный симптом stale TCP-socket из connection pool после долгого
///    Doze) пересоздаёт `httpClientAdapter` и повторяет запрос один раз.
///    Без этого мы получали `Connection refused, port=<random ephemeral>`
///    — Dart пытался reuse мёртвый socket из pool'а.
class DioFactory {
  DioFactory(this._storage);

  final SecureStorageService _storage;

  /// Колбэк рефреша устанавливается AuthRepository (чтобы избежать циклической
  /// зависимости storage ↔ api).
  RefreshFn? _refresh;

  /// Singleton Dio (создаётся в [build]) — ссылка нужна чтобы lifecycle-observer
  /// мог сбрасывать его connection pool при возврате app из background.
  Dio? _dio;

  void bindRefresh(RefreshFn fn) {
    _refresh = fn;
  }

  /// Сбрасывает HttpClient connection pool. Безопасно вызывать в любое время —
  /// в полёте запросов не убивает: новый adapter подхватится при следующем
  /// `dio.fetch()`. Используется:
  ///   - lifecycle-observer'ом при возврате app из long-idle background;
  ///   - retry-interceptor'ом при `connectionError`.
  void resetConnections() {
    final dio = _dio;
    if (dio == null) return;
    final old = dio.httpClientAdapter;
    dio.httpClientAdapter = IOHttpClientAdapter();
    // Закрываем старый адаптер ПОСЛЕ присвоения нового, чтобы in-flight
    // запросы (если есть) сначала переехали на свежий pool.
    try {
      old.close(force: true);
    } catch (_) {
      // close() может бросить если уже закрыт — игнорируем.
    }
    if (kDebugMode) debugPrint('[DioFactory] connection pool reset');
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
        onError: (err, handler) async {
          // Stale-connection retry: typical симптом — `port=<ephemeral>`
          // в SocketException когда Dart reuse'ит мёртвый socket из pool'а
          // после Doze. Лечится пересозданием HttpClient adapter и retry.
          if (_isStaleConnection(err) &&
              err.requestOptions.extra['didRetryConn'] != true) {
            if (kDebugMode) {
              debugPrint(
                '[DioFactory] stale connection detected '
                '(${err.type}, ${err.error.runtimeType}), '
                'recreating adapter and retrying ${err.requestOptions.path}',
              );
            }
            resetConnections();
            try {
              final retried = await dio.fetch(
                err.requestOptions.copyWith(
                  extra: {...err.requestOptions.extra, 'didRetryConn': true},
                ),
              );
              return handler.resolve(retried);
            } on DioException catch (e) {
              return handler.next(e);
            }
          }
          handler.next(err);
        },
      ),
    );

    _dio = dio;
    return dio;
  }
}

/// True если ошибка — типичный признак мёртвого socket'а из connection pool.
/// Покрывает:
///   - `DioExceptionType.connectionError` (Dio 5+) — основная категория
///   - `connectionTimeout` — устарел socket, новые SYN не доходят
///   - `SocketException` напрямую (на случай если Dio не классифицировал)
bool _isStaleConnection(DioException err) {
  switch (err.type) {
    case DioExceptionType.connectionError:
    case DioExceptionType.connectionTimeout:
      return true;
    case DioExceptionType.unknown:
      return err.error is SocketException;
    default:
      return false;
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
