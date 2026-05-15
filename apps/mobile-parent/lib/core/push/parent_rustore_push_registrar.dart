import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_rustore_push/flutter_rustore_push.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// v0.51 RuStore Push (lesson #24): параллельный FCM-каналу транспорт push'ей
/// для parent-устройства. Регистрирует RuStore-токен на backend и подписывается
/// на onNewToken для rotation.
///
/// Архитектура зеркалирует [ParentFcmRegistrar]:
///   - вызов через Riverpod-provider после login (когда accessToken в storage);
///   - best-effort: ошибки логируем, не прерываем UX.
///
/// На iOS — no-op (RuStore Push SDK Android-only).
class ParentRuStorePushRegistrar {
  ParentRuStorePushRegistrar({required Dio dio}) : _dio = dio;
  final Dio _dio;
  bool _callbacksAttached = false;

  Future<void> register() async {
    if (!Platform.isAndroid) return;
    try {
      _attachCallbacks();

      // available() проверяет наличие RuStore client'а (Android-app RuStore
      // Mobile зарегистрирован как trusted installer). Если RuStore client'а
      // нет — getToken() кинет, FCM-канал продолжит работать.
      try {
        final available = await RustorePushClient.available();
        debugPrint('[GMD rustore-push] available: $available');
      } catch (e) {
        debugPrint('[GMD rustore-push] available() failed: $e (likely no client)');
        return;
      }

      final token = await RustorePushClient.getToken();
      if (token.isEmpty) {
        debugPrint('[GMD rustore-push] empty token — SDK not ready or project_id missing');
        return;
      }
      await _sendToBackend(token);
    } catch (e) {
      debugPrint('[GMD rustore-push] register failed: $e');
    }
  }

  void _attachCallbacks() {
    if (_callbacksAttached) return;
    _callbacksAttached = true;
    RustorePushClient.attachCallbacks(
      onNewToken: (token) {
        debugPrint('[GMD rustore-push] onNewToken (len=${token.length})');
        _sendToBackend(token).catchError((e) {
          debugPrint('[GMD rustore-push] onNewToken send failed: $e');
        });
      },
      onMessageReceived: (msg) {
        debugPrint('[GMD rustore-push] onMessageReceived id=${msg.messageId} data=${msg.data}');
      },
      onMessageOpenedApp: (msg) {
        debugPrint('[GMD rustore-push] onMessageOpenedApp id=${msg.messageId}');
      },
      onDeletedMessages: () {
        debugPrint('[GMD rustore-push] onDeletedMessages');
      },
      onError: (err) {
        debugPrint('[GMD rustore-push] onError: $err');
      },
    );
  }

  Future<void> _sendToBackend(String token) async {
    final pkg = await PackageInfo.fromPlatform();
    await _dio.post<dynamic>(
      '/parents/devices/rustore-token',
      data: {
        'rustorePushToken': token,
        'platform': 'android',
        'appVersion': '${pkg.version}+${pkg.buildNumber}',
      },
    );
    debugPrint('[GMD rustore-push] token registered (len=${token.length})');
  }
}
