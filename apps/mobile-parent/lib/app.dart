import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router/app_router.dart';

class GmdParentApp extends ConsumerStatefulWidget {
  const GmdParentApp({super.key});

  @override
  ConsumerState<GmdParentApp> createState() => _GmdParentAppState();
}

class _GmdParentAppState extends ConsumerState<GmdParentApp> {
  late final _router = AppRouter.build(ref);

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'GMD',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF2E7D32),
      ),
      routerConfig: _router,
    );
  }
}
