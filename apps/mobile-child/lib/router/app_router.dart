import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';
import '../features/claim/claim_manual_screen.dart';
import '../features/claim/claim_screen.dart';
import '../features/debug/debug_screen.dart';
import '../features/home/home_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/permissions/battery_step.dart';
import '../features/permissions/location_step.dart';
import '../features/permissions/notifications_step.dart';

class AppRouter {
  static GoRouter buildRouter({String initialLocation = '/onboarding'}) =>
      GoRouter(initialLocation: initialLocation, routes: _routes);

  // Backward-compat для тестов/старого кода: default — onboarding.
  static final GoRouter router = buildRouter();

  static final List<RouteBase> _routes = [
    GoRoute(
      path: '/onboarding',
      builder: (context, _) => OnboardingScreen(
        onConnect: () => context.go('/claim'),
      ),
    ),
    GoRoute(
      path: '/claim',
      builder: (_, _) => const ClaimScreen(),
    ),
    GoRoute(
      path: '/claim/manual',
      builder: (_, _) => const ClaimManualScreen(),
    ),
    GoRoute(
      path: '/permissions/notifications',
      builder: (_, _) => const NotificationsPermissionsStep(),
    ),
    GoRoute(
      path: '/permissions/location',
      builder: (_, _) => const LocationPermissionsStep(),
    ),
    GoRoute(
      path: '/permissions/battery',
      builder: (_, _) => const BatteryPermissionsStep(),
    ),
    GoRoute(
      path: '/permissions/devadmin',
      builder: (_, _) => const _DeviceAdminPlaceholder(),
    ),
    GoRoute(
      path: '/home',
      builder: (_, _) => const HomeScreen(),
    ),
    GoRoute(
      path: '/debug',
      builder: (_, _) => const DebugScreen(),
    ),
  ];
}

class _DeviceAdminPlaceholder extends StatelessWidget {
  const _DeviceAdminPlaceholder();
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: ElevatedButton(
        onPressed: () => GoRouter.of(context).go('/home'),
        child: const Text('Продолжить (devadmin placeholder)'),
      ),
    ),
  );
}
