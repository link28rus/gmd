import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/core/api/dio_client.dart';
import 'package:periscop_parent/core/auth/auth_repository.dart';
import 'package:periscop_parent/core/storage/secure_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// JWT с заданным `exp`; подпись не проверяется — клиент читает только payload.
String _jwt(DateTime exp) {
  String part(Map<String, Object> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  return '${part({'alg': 'HS256'})}.'
      '${part({'sub': 'u1', 'exp': exp.millisecondsSinceEpoch ~/ 1000})}.sig';
}

/// Отвечает на `/auth/refresh` новой парой токенов и считает вызовы.
class _RefreshAdapter implements HttpClientAdapter {
  _RefreshAdapter(this.newAccess);
  final String newAccess;
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    await Future<void>.delayed(const Duration(milliseconds: 10));
    return ResponseBody.fromString(
      jsonEncode({'accessToken': newAccess, 'refreshToken': 'r2'}),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late SecureStorageService storage;
  late _RefreshAdapter adapter;
  late AuthRepository repo;
  final fresh = _jwt(DateTime.now().add(const Duration(minutes: 15)));

  Future<void> setUpWith(Map<String, Object> prefs) async {
    SharedPreferences.setMockInitialValues(prefs);
    storage = SecureStorageService();
    adapter = _RefreshAdapter(fresh);
    final dio = Dio()..httpClientAdapter = adapter;
    repo = AuthRepository(dio: dio, storage: storage, dioFactory: DioFactory(storage));
  }

  test('годный токен отдаётся без refresh', () async {
    await setUpWith({'access_token': fresh, 'refresh_token': 'r1'});
    expect(await repo.freshAccessToken(), fresh);
    expect(adapter.calls, 0);
  });

  test('протухший токен обновляется через /auth/refresh', () async {
    final stale = _jwt(DateTime.now().subtract(const Duration(minutes: 30)));
    await setUpWith({'access_token': stale, 'refresh_token': 'r1'});
    expect(await repo.freshAccessToken(), fresh);
    expect(adapter.calls, 1);
    expect(await storage.readRefreshToken(), 'r2');
  });

  test('истекает раньше minValidity — тоже обновляется', () async {
    final soon = _jwt(DateTime.now().add(const Duration(minutes: 2)));
    await setUpWith({'access_token': soon, 'refresh_token': 'r1'});
    expect(await repo.freshAccessToken(), fresh);
    expect(adapter.calls, 1);
  });

  test('параллельные вызовы делают один refresh', () async {
    final stale = _jwt(DateTime.now().subtract(const Duration(minutes: 30)));
    await setUpWith({'access_token': stale, 'refresh_token': 'r1'});
    final results = await Future.wait([repo.freshAccessToken(), repo.freshAccessToken()]);
    expect(results, [fresh, fresh]);
    expect(adapter.calls, 1);
  });

  test('без refresh-токена — null', () async {
    final stale = _jwt(DateTime.now().subtract(const Duration(minutes: 30)));
    await setUpWith({'access_token': stale});
    expect(await repo.freshAccessToken(), isNull);
    expect(adapter.calls, 0);
  });
}
