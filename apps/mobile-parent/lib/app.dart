import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api/connection_lifecycle_observer.dart';
import 'core/providers.dart';
import 'router/app_router.dart';

class GmdParentApp extends ConsumerStatefulWidget {
  const GmdParentApp({super.key});

  @override
  ConsumerState<GmdParentApp> createState() => _GmdParentAppState();
}

class _GmdParentAppState extends ConsumerState<GmdParentApp> {
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
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(_connectionObserver);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'GMD',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF2E7D32),
      ),
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
