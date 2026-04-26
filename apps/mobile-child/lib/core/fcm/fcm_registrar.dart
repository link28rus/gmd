import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';

import '../api/child_api.dart';
import '../api/dio_client.dart';
import '../config/env.dart';
import '../diag/diag_channel.dart';
import '../storage/secure_storage_service.dart';

const _tag = 'fcm_registrar';

/// v0.37: получает FCM token у Firebase, шлёт его на backend и подписывается
/// на onTokenRefresh для повторной регистрации при rotate'е токена.
///
/// Должен вызываться:
///   1. На старте app в main() — после Firebase.initializeApp() и при наличии
///      device-token (т.е. claim уже произошёл).
///   2. После claim'а в onboarding flow — чтобы первый push прилетел сразу.
///
/// Best-effort: любые ошибки (нет Google Play Services, network, backend down)
/// логируем и продолжаем — backend fallback'ится на poll-команды.
class FcmRegistrar {
  static StreamSubscription<String>? _refreshSub;

  /// Запускает регистрацию в фоне. Не throws — все ошибки в DiagLog.
  static Future<void> registerInBackground() async {
    try {
      await _registerOnce();
      _subscribeToRefresh();
    } catch (e) {
      unawaited(diagLog(_tag, 'register failed: $e (poll-fallback ok)'));
    }
  }

  /// Получает текущий FCM token и шлёт на backend.
  /// Возвращает true если успешно.
  static Future<bool> _registerOnce() async {
    final messaging = FirebaseMessaging.instance;

    // Запрос разрешения для Android 13+ (POST_NOTIFICATIONS) — для data-only
    // push'а технически не нужен, но без него Android может скрывать silent
    // delivery в некоторых OEM. Best-effort.
    try {
      await messaging.requestPermission(alert: false, badge: false, sound: false);
    } catch (e) {
      unawaited(diagLog(_tag, 'requestPermission failed (continuing): $e'));
    }

    final token = await messaging.getToken();
    if (token == null || token.isEmpty) {
      unawaited(diagLog(_tag, 'getToken returned null/empty — Firebase not ready'));
      return false;
    }
    unawaited(diagLog(_tag, 'got FCM token: ${token.substring(0, 16)}…'));

    final deviceToken = await SecureStorageService().readDeviceToken();
    if (deviceToken == null || deviceToken.isEmpty) {
      unawaited(diagLog(_tag, 'no device-token — skip registration (will retry on next start)'));
      return false;
    }

    final api = ChildApi(buildDio(baseUrl: apiBaseUrl));
    await api.setFcmToken(fcmToken: token, deviceToken: deviceToken);
    unawaited(diagLog(_tag, 'FCM token registered on backend'));
    return true;
  }

  static void _subscribeToRefresh() {
    _refreshSub?.cancel();
    _refreshSub = FirebaseMessaging.instance.onTokenRefresh.listen((newToken) async {
      unawaited(diagLog(_tag, 'onTokenRefresh: ${newToken.substring(0, 16)}…'));
      try {
        final deviceToken = await SecureStorageService().readDeviceToken();
        if (deviceToken == null || deviceToken.isEmpty) {
          unawaited(diagLog(_tag, 'onTokenRefresh: no device-token, skipping'));
          return;
        }
        final api = ChildApi(buildDio(baseUrl: apiBaseUrl));
        await api.setFcmToken(fcmToken: newToken, deviceToken: deviceToken);
        unawaited(diagLog(_tag, 'onTokenRefresh: backend updated'));
      } catch (e) {
        unawaited(diagLog(_tag, 'onTokenRefresh registration failed: $e'));
      }
    });
  }
}
