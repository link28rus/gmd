import 'dart:async';

import 'package:flutter_rustore_push/flutter_rustore_push.dart';

import '../api/child_api.dart';
import '../api/dio_client.dart';
import '../config/env.dart';
import '../diag/diag_channel.dart';
import '../storage/secure_storage_service.dart';

const _tag = 'rustore_push_registrar';

/// v0.51 RuStore Push (lesson #24): параллельный FCM-каналу транспорт push'ей.
/// Регистрирует RuStore-токен устройства на backend и подписывается на
/// onNewToken для rotation.
///
/// Архитектура зеркалирует [FcmRegistrar]:
///   - На старте app в main() вызывается registerInBackground() после того
///     как RuStore SDK инициализировался (manifest meta-data project_id +
///     наличие RuStore client'а на устройстве).
///   - Если проект id не задан / RuStore client отсутствует — [RustorePushClient]
///     кинет исключение, мы это поглощаем и логируем (FCM работает параллельно).
///
/// Best-effort: любые ошибки (нет RuStore client'а, нет project_id, network,
/// backend down) логируем и продолжаем — backend fallback'ится на FCM или
/// poll-команды.
class RuStorePushRegistrar {
  static bool _callbacksAttached = false;

  /// Запускает регистрацию в фоне. Не throws — все ошибки в DiagLog.
  static Future<void> registerInBackground() async {
    try {
      _attachCallbacks();
      await _registerOnce();
    } catch (e) {
      unawaited(diagLog(_tag, 'register failed: $e (FCM/poll-fallback ok)'));
    }
  }

  /// Подписка на onNewToken — RuStore SDK ротирует токены реже FCM, но всё
  /// равно надо поймать rotate чтобы backend не слал в мёртвый token.
  /// onMessageReceived здесь НЕ обрабатываем как UX (показ нотификации) —
  /// этим занимается AndroidManifest meta-data + nativeService SDK. Логируем
  /// только для диагностики.
  static void _attachCallbacks() {
    if (_callbacksAttached) return;
    _callbacksAttached = true;
    RustorePushClient.attachCallbacks(
      onNewToken: (token) {
        unawaited(diagLog(_tag, 'onNewToken: ${_truncate(token)}'));
        unawaited(_sendTokenToBackend(token));
      },
      onMessageReceived: (msg) {
        unawaited(diagLog(
          _tag,
          'onMessageReceived id=${msg.messageId} data=${msg.data}',
        ));
      },
      onMessageOpenedApp: (msg) {
        unawaited(diagLog(_tag, 'onMessageOpenedApp id=${msg.messageId}'));
      },
      onDeletedMessages: () {
        unawaited(diagLog(_tag, 'onDeletedMessages'));
      },
      onError: (err) {
        unawaited(diagLog(_tag, 'onError: $err'));
      },
    );
  }

  /// Получает текущий RuStore token и шлёт на backend.
  static Future<bool> _registerOnce() async {
    // available() → есть ли RuStore client (Android-приложение RuStore Mobile,
    // зарегистрированное в системе как trusted installer на Android 12+).
    // На устройстве без RuStore client'а — false, нет смысла даже пробовать
    // getToken.
    try {
      final available = await RustorePushClient.available();
      // available возвращает структуру с success/featureStatus; полем
      // featureAvailable определяется доступность. Если структура изменится в
      // будущих версиях SDK — упадём в catch и поглотим.
      unawaited(diagLog(_tag, 'available: $available'));
    } catch (e) {
      unawaited(diagLog(_tag, 'available() failed: $e (likely no RuStore client)'));
      return false;
    }

    final token = await RustorePushClient.getToken();
    if (token.isEmpty) {
      unawaited(diagLog(_tag, 'getToken returned empty — SDK not ready or project_id missing'));
      return false;
    }
    unawaited(diagLog(_tag, 'got RuStore token: ${_truncate(token)}'));
    return _sendTokenToBackend(token);
  }

  static Future<bool> _sendTokenToBackend(String token) async {
    final deviceToken = await SecureStorageService().readDeviceToken();
    if (deviceToken == null || deviceToken.isEmpty) {
      unawaited(diagLog(_tag, 'no device-token — skip (will retry on next start)'));
      return false;
    }
    try {
      final api = ChildApi(buildDio(baseUrl: apiBaseUrl));
      await api.setRustorePushToken(rustorePushToken: token, deviceToken: deviceToken);
      unawaited(diagLog(_tag, 'RuStore token registered on backend'));
      return true;
    } catch (e) {
      unawaited(diagLog(_tag, 'backend registration failed: $e'));
      return false;
    }
  }

  static String _truncate(String s) =>
      s.length <= 16 ? s : '${s.substring(0, 16)}…';
}
