import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api/connection_lifecycle_observer.dart';
import 'core/diag/diag_channel.dart';
import 'core/providers.dart';
import 'core/push/push_deeplink.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_mode_provider.dart';
import 'features/zones/zones_providers.dart';
import 'router/app_router.dart';

class PeriscopParentApp extends ConsumerStatefulWidget {
  const PeriscopParentApp({super.key});

  @override
  ConsumerState<PeriscopParentApp> createState() => _PeriscopParentAppState();
}

class _PeriscopParentAppState extends ConsumerState<PeriscopParentApp> {
  late final _router = AppRouter.build(ref);
  late final ConnectionLifecycleObserver _connectionObserver;

  @override
  void initState() {
    super.initState();
    // Сбрасываем Dio connection pool при возврате app из background после
    // длительного простоя — Android Doze убивает TCP keepalive у idle сокетов,
    // но Dart HttpClient об этом не знает и reuse'ит мёртвый socket. См.
    // `core/api/connection_lifecycle_observer.dart` для деталей.
    _connectionObserver = ConnectionLifecycleObserver(
      ref.read(dioFactoryProvider),
    );
    WidgetsBinding.instance.addObserver(_connectionObserver);
    // v0.66.0: тап по уведомлению, когда приложение уже открыто (onNewIntent).
    // Стартовый интент разбирает SplashScreen.
    PushDeepLinkChannel.listen(_openPush);
  }

  void _openPush(PushDeepLink link) {
    final route = link.route;
    unawaited(diagLog('push', 'onPush ${link.type} -> $route'));
    if (route == null) return;
    // Не вошли — ведёт на /login redirect; push не держим.
    if (ref.read(authSessionProvider) == null) return;
    if (link.type.startsWith('GEOFENCE_')) {
      // Лента и «кто внутри» уже могли быть открыты — перечитываем.
      ref.invalidate(zonesListProvider);
      ref.invalidate(zoneEventsProvider);
    }
    _router.go(route);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(_connectionObserver);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'Перископ',
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: themeMode,
      // Русская локализация для DatePicker и других встроенных виджетов.
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('ru'), Locale('en')],
      locale: const Locale('ru'),
      routerConfig: _router,
    );
  }
}
