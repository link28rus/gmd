import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';

/// v0.46: регистрация FCM-токена родителя на бэкенде.
///
/// Вызов: после успешного login (когда `accessToken` уже в storage) и
/// при каждом запуске app (в случае onTokenRefresh).
///
/// Поток:
/// 1. Запросить разрешение на POST_NOTIFICATIONS (Android 13+).
/// 2. Получить FCM-токен (`FirebaseMessaging.instance.getToken()`).
/// 3. POST /parents/devices/fcm-token (auth Bearer).
/// 4. Подписаться на `onTokenRefresh` — при rotation Firebase шлёт новый токен.
class ParentFcmRegistrar {
  ParentFcmRegistrar({required Dio dio}) : _dio = dio;
  final Dio _dio;
  bool _refreshSubscribed = false;

  Future<void> register() async {
    if (!Platform.isAndroid) {
      // iOS пока не в scope — Firebase iOS требует APNs setup.
      return;
    }
    try {
      // Permission request — на Android 13+ обязателен; на 12 и ниже granted by default.
      final status = await Permission.notification.request();
      if (status.isPermanentlyDenied) {
        debugPrint('[GMD fcm] notification permission permanently denied — skip');
        return;
      }
      if (status.isDenied) {
        debugPrint('[GMD fcm] notification permission denied — skip (try later)');
        return;
      }

      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) {
        debugPrint('[GMD fcm] empty token — skip');
        return;
      }

      await _sendToBackend(token);

      if (!_refreshSubscribed) {
        _refreshSubscribed = true;
        FirebaseMessaging.instance.onTokenRefresh.listen((newToken) {
          _sendToBackend(newToken).catchError((e) {
            debugPrint('[GMD fcm] onTokenRefresh send failed: $e');
          });
        });
      }
    } catch (e) {
      debugPrint('[GMD fcm] register failed: $e');
    }
  }

  Future<void> _sendToBackend(String token) async {
    final pkg = await PackageInfo.fromPlatform();
    await _dio.post<dynamic>(
      '/parents/devices/fcm-token',
      data: {
        'fcmToken': token,
        'platform': 'android',
        // deviceName заполним позже через device_info_plus (TODO v0.47).
        'appVersion': '${pkg.version}+${pkg.buildNumber}',
      },
    );
    debugPrint('[GMD fcm] token registered (len=${token.length})');
  }
}
