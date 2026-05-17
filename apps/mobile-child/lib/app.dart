import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'router/app_router.dart';

class GmdChildApp extends ConsumerWidget {
  const GmdChildApp({super.key, this.initialLocation = '/onboarding'});

  final String initialLocation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Перископ',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF2E7D32)),
      routerConfig: AppRouter.buildRouter(initialLocation: initialLocation),
      debugShowCheckedModeBanner: false,
    );
  }
}
