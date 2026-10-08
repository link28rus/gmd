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

  // v0.70.0: устройство геолокации родителя (POST /parent-location/devices).
  // Не входит в clearAll: при выходе устройство удаляет
  // ParentLocationController.onLogout (нужен ещё живой JWT для DELETE), а
  // после протухшей сессии запись нужна, чтобы тот же пользователь при
  // следующем входе продолжил с тем же устройством.
  static const _kPlocDeviceId = 'parent_location_device_id';
  static const _kPlocToken = 'parent_location_token';
  static const _kPlocUserId = 'parent_location_user_id';

  Future<void> saveParentLocationDevice({
    required String userId,
    required String deviceId,
    required String token,
  }) async {
    final prefs = await _prefs;
    await prefs.setString(_kPlocUserId, userId);
    await prefs.setString(_kPlocDeviceId, deviceId);
    await prefs.setString(_kPlocToken, token);
  }

  Future<({String userId, String deviceId, String token})?> readParentLocationDevice() async {
    final prefs = await _prefs;
    final userId = prefs.getString(_kPlocUserId);
    final deviceId = prefs.getString(_kPlocDeviceId);
    final token = prefs.getString(_kPlocToken);
    if (userId == null || deviceId == null || token == null) return null;
    if (userId.isEmpty || deviceId.isEmpty || token.isEmpty) return null;
    return (userId: userId, deviceId: deviceId, token: token);
  }

  Future<void> clearParentLocationDevice() async {
    final prefs = await _prefs;
    await prefs.remove(_kPlocUserId);
    await prefs.remove(_kPlocDeviceId);
    await prefs.remove(_kPlocToken);
  }

  Future<void> clearAll() async {
    final prefs = await _prefs;
    await prefs.remove(_kAccessToken);
    await prefs.remove(_kRefreshToken);
    await prefs.remove(_kUserJson);
    await prefs.remove(_kFamilyJson);
  }
}
