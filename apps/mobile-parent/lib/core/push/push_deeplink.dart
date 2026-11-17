import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_rustore_push/flutter_rustore_push.dart';

/// v0.66.0: переход из системного уведомления.
///
/// `ParentFirebaseMessagingService` кладёт в интент `fcm_type`,
/// `deeplink_child_id`, `zone_id`; `MainActivity` отдаёт их через канал
/// `pro.periscop.parent/push`: `getInitialPush` — стартовый интент (один раз),
/// `onPush` — тап, когда приложение уже открыто (`onNewIntent`).
@immutable
class PushDeepLink {
  const PushDeepLink({required this.type, this.childId, this.zoneId});

  final String type;
  final String? childId;
  final String? zoneId;

  static PushDeepLink? fromMap(Map<Object?, Object?>? map) {
    if (map == null) return null;
    final type = map['type'];
    if (type is! String || type.isEmpty) return null;
    String? str(Object? v) => (v is String && v.isNotEmpty) ? v : null;
    return PushDeepLink(
      type: type,
      childId: str(map['childId']),
      zoneId: str(map['zoneId']),
    );
  }

  /// Куда вести: события геозон — в ленту зоны (с фильтром по ребёнку),
  /// остальные — на экран ребёнка. null — некуда (нет id).
  String? get route {
    if (type.startsWith('GEOFENCE_') && zoneId != null) {
      final q = <String, String>{'zoneId': zoneId!, 'childId': ?childId};
      return Uri(path: '/home/zones/events', queryParameters: q).toString();
    }
    if (childId != null) return '/home/child/${Uri.encodeComponent(childId!)}';
    return null;
  }
}

class PushDeepLinkChannel {
  static const MethodChannel _ch = MethodChannel('pro.periscop.parent/push');
  static void Function(PushDeepLink)? _onExternalPush;
  static PushDeepLink? _pendingExternal;
  static bool _externalReady = false;

  static void prepareStartup() {
    _externalReady = false;
  }

  static PushDeepLink? completeStartup() {
    _externalReady = true;
    final pending = _pendingExternal;
    _pendingExternal = null;
    return pending;
  }

  static void openExternal(PushDeepLink link) {
    if (_externalReady && _onExternalPush != null) {
      _onExternalPush!(link);
    } else {
      _pendingExternal = link;
    }
  }

  /// Push, которым приложение запустили. Отдаётся один раз.
  static Future<PushDeepLink?> takeInitial() async {
    // Канал есть только в Android-сборке (MainActivity). На iOS и в тестах
    // вызов без обработчика в fake-async не завершается — не зовём.
    if (!Platform.isAndroid) return null;
    try {
      final map = await _ch.invokeMapMethod<Object?, Object?>('getInitialPush');
      final link = PushDeepLink.fromMap(map);
      if (link != null) return link;
    } catch (_) {
      // Нет FCM-интента — проверяем собственный cold-start API RuStore.
    }
    return takeRuStoreInitial();
  }

  static Future<PushDeepLink?> takeRuStoreInitial() async {
    try {
      final message = await RustorePushClient.getInitialMessage();
      final data = message?.data;
      return data?['type'] == 'PERMISSION_DEGRADED'
          ? PushDeepLink.fromMap(data)
          : null;
    } catch (_) {
      return null;
    }
  }

  /// Тапы по уведомлениям, пока приложение открыто.
  static void listen(void Function(PushDeepLink link) onPush) {
    _onExternalPush = onPush;
    _ch.setMethodCallHandler((call) async {
      if (call.method != 'onPush') return null;
      final args = call.arguments;
      final link = PushDeepLink.fromMap(args is Map ? args : null);
      if (link != null) onPush(link);
      return null;
    });
  }
}
