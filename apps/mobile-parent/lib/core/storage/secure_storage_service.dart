import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Хранилище токенов и профиля родителя.
///
/// Используем обычный `SharedPreferences` (не `flutter_secure_storage`):
/// flutter_secure_storage 9.x с `encryptedSharedPreferences: true` теряет
/// MasterKey на ряде Android 14/15 OEM-сборок (наблюдалось на MIUI на
/// Redmi Note 11): после перезапуска `read()` возвращает null, юзера
/// выбрасывает на /login. App-private storage и так изолирован Android,
/// шифрование на уровне SharedPreferences избыточно для refresh-токена,
/// который ротируется на сервере при каждом refresh/logout.
class SecureStorageService {
  SecureStorageService();

  static const _kAccessToken = 'access_token';
  static const _kRefreshToken = 'refresh_token';
  static const _kUserJson = 'user_json';
  static const _kFamilyJson = 'family_json';

  Future<SharedPreferences> get _prefs => SharedPreferences.getInstance();

  Future<void> saveAccessToken(String token) async =>
      (await _prefs).setString(_kAccessToken, token);

  Future<String?> readAccessToken() async => (await _prefs).getString(_kAccessToken);

  Future<void> saveRefreshToken(String token) async =>
      (await _prefs).setString(_kRefreshToken, token);

  Future<String?> readRefreshToken() async => (await _prefs).getString(_kRefreshToken);

  Future<void> saveUser(Map<String, dynamic> user) async =>
      (await _prefs).setString(_kUserJson, jsonEncode(user));

  Future<Map<String, dynamic>?> readUser() async {
    final raw = (await _prefs).getString(_kUserJson);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> saveFamily(Map<String, dynamic> family) async =>
      (await _prefs).setString(_kFamilyJson, jsonEncode(family));

  Future<Map<String, dynamic>?> readFamily() async {
    final raw = (await _prefs).getString(_kFamilyJson);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> clearAll() async {
    final prefs = await _prefs;
    await prefs.remove(_kAccessToken);
    await prefs.remove(_kRefreshToken);
    await prefs.remove(_kUserJson);
    await prefs.remove(_kFamilyJson);
  }
}
