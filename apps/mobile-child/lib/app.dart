import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'router/app_router.dart';

class GmdChildApp extends ConsumerWidget {
  const GmdChildApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'GMD',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF2E7D32)),
      routerConfig: AppRouter.router,
      debugShowCheckedModeBanner: false,
    );
  }
}
