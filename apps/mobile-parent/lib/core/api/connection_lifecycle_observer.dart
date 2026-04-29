import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'dio_client.dart';

/// Наблюдатель жизненного цикла приложения, отвечающий за чистоту Dio
/// connection pool'а после длительного простоя в background.
///
/// **Зачем нужно:** Android Doze разрывает TCP keepalive у idle-сокетов в
/// процессе app, но Dart `HttpClient` об этом не уведомляется и продолжает
/// держать socket в connection pool'е как «живой». Первый запрос после
/// возврата app в foreground reuse'ит мёртвый socket → `Connection refused`
/// с эфемерным портом в сообщении (мы видели port=41790 в проде 2026-04-30).
///
/// `ConnectionRetryInterceptor` в `dio_client.dart` это лечит реактивно —
/// retry с пересозданием adapter. Этот observer лечит проактивно: при
/// возврате app из background после ≥[idleResetThreshold] minutes — сразу
/// сбрасывает pool, чтобы первый запрос не падал.
///
/// Использование:
/// ```dart
/// final observer = ConnectionLifecycleObserver(dioFactory);
/// WidgetsBinding.instance.addObserver(observer);
/// ```
class ConnectionLifecycleObserver with WidgetsBindingObserver {
  ConnectionLifecycleObserver(
    this._dioFactory, {
    this.idleResetThreshold = const Duration(minutes: 5),
  });

  final DioFactory _dioFactory;

  /// Сколько app должна пробыть в background чтобы при возврате считалось
  /// что connection pool «протух». 5 минут — компромисс: меньше → лишние
  /// reset'ы для частых переключений между app, больше → реальные баги
  /// (Doze начинается через ~30 мин в screen-off, но кратковременные
  /// background-переходы ещё могут портить keepalive).
  final Duration idleResetThreshold;

  DateTime? _backgroundedAt;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _backgroundedAt ??= DateTime.now();
        break;
      case AppLifecycleState.resumed:
        final since = _backgroundedAt;
        _backgroundedAt = null;
        if (since == null) return;
        final idle = DateTime.now().difference(since);
        if (idle >= idleResetThreshold) {
          if (kDebugMode) {
            debugPrint(
              '[ConnectionLifecycleObserver] app returned from background '
              'after ${idle.inSeconds}s idle ≥ ${idleResetThreshold.inSeconds}s '
              '— resetting Dio connection pool',
            );
          }
          _dioFactory.resetConnections();
        }
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        // inactive — короткий transient (например, нотификация поверх).
        // detached — terminate, чистить нечего.
        break;
    }
  }
}
