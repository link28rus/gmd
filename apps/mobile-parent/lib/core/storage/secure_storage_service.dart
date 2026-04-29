import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Хранилище секретов родителя: accessToken (короткоживущий, 15м),
/// refreshToken (30д), сериализованные User/Family для splash-экрана.
class SecureStorageService {
  SecureStorageService([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  static const _kAccessToken = 'access_token';
  static const _kRefreshToken = 'refresh_token';
  static const _kUserJson = 'user_json';
  static const _kFamilyJson = 'family_json';

  Future<void> saveAccessToken(String token) =>
      _storage.write(key: _kAccessToken, value: token);

  Future<String?> readAccessToken() => _storage.read(key: _kAccessToken);

  Future<void> saveRefreshToken(String token) =>
      _storage.write(key: _kRefreshToken, value: token);

  Future<String?> readRefreshToken() => _storage.read(key: _kRefreshToken);

  Future<void> saveUser(Map<String, dynamic> user) =>
      _storage.write(key: _kUserJson, value: jsonEncode(user));

  Future<Map<String, dynamic>?> readUser() async {
    final raw = await _storage.read(key: _kUserJson);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> saveFamily(Map<String, dynamic> family) =>
      _storage.write(key: _kFamilyJson, value: jsonEncode(family));

  Future<Map<String, dynamic>?> readFamily() async {
    final raw = await _storage.read(key: _kFamilyJson);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> clearAll() => _storage.deleteAll();
}
