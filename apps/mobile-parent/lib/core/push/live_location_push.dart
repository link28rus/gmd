import 'dart:async';

import 'package:flutter/services.dart';

/// v0.69.0: тихие push `LOCATION_UPDATED` от сервера — «у ребёнка новая
/// точка». Нативный ParentFirebaseMessagingService уведомление не показывает,
/// а передаёт `childId` сюда через канал `pro.periscop.parent/live`.
///
/// Сервер шлёт их только тем родителям, у кого открыт экран ребёнка
/// (см. `ChildrenRepository.watchLocation`).
class LiveLocationPush {
  LiveLocationPush._();

  static const _channel = MethodChannel('pro.periscop.parent/live');
  static final _updates = StreamController<String>.broadcast();
  static bool _listening = false;

  /// Поток id детей, у которых появилась новая точка.
  static Stream<String> get childUpdates {
    if (!_listening) {
      _listening = true;
      _channel.setMethodCallHandler((call) async {
        if (call.method != 'locationUpdated') return;
        final args = call.arguments;
        final childId = args is Map ? args['childId'] : null;
        if (childId is String && childId.isNotEmpty) _updates.add(childId);
      });
    }
    return _updates.stream;
  }
}
