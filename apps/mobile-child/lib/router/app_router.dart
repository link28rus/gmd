import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';
import '../features/claim/claim_manual_screen.dart';
import '../features/claim/claim_screen.dart';
import '../features/debug/debug_screen.dart';
import '../features/home/home_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/permissions/activity_recognition_step.dart';
import '../features/permissions/battery_step.dart';
import '../features/permissions/location_step.dart';
import '../features/permissions/microphone_step.dart';
import '../features/permissions/notifications_step.dart';
import '../features/permissions/usage_stats_step.dart';
import '../features/permissions/accessibility_step.dart';
import '../features/permissions/overlay_step.dart';
import '../features/escape/escape_screen.dart';

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
      path: '/permissions/activity',
      builder: (_, _) => const ActivityRecognitionStep(),
    ),
    GoRoute(
      path: '/permissions/microphone',
      builder: (_, _) => const MicrophoneStep(),
    ),
    GoRoute(
      path: '/permissions/devadmin',
      builder: (_, _) => const _DeviceAdminPlaceholder(),
    ),
    GoRoute(
      path: '/permissions/usage-stats',
      builder: (_, _) => const UsageStatsStep(),
    ),
    // v0.39 Phase 6.2: Accessibility (для блокировки приложений). Идёт
    // после usage-stats. Без него a11y service не подключён, и заблокированное
    // приложение не определится.
    GoRoute(
      path: '/permissions/accessibility',
      builder: (_, _) => const AccessibilityStep(),
    ),
    // v0.39.5 Phase 6.2 fix: SYSTEM_ALERT_WINDOW для visual overlay'а.
    // Идёт ПОСЛЕ accessibility — без него блокировка работает (HOME action),
    // но без красивого экрана «🔒 Телефон заблокирован» с таймером.
    GoRoute(
      path: '/permissions/overlay',
      builder: (_, _) => const OverlayStep(),
    ),
    GoRoute(
      path: '/home',
      builder: (_, _) => const HomeScreen(),
    ),
    GoRoute(
      path: '/debug',
      builder: (_, _) => const DebugScreen(),
    ),
    // v0.38 escape hatch: показывается когда родитель удалил ребёнка.
    GoRoute(
      path: '/escape',
      builder: (_, _) => const EscapeScreen(),
    ),
  ];
}

class _DeviceAdminPlaceholder extends StatelessWidget {
  const _DeviceAdminPlaceholder();
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: ElevatedButton(
        onPressed: () => GoRouter.of(context).go('/permissions/usage-stats'),
        child: const Text('Продолжить (devadmin placeholder)'),
      ),
    ),
  );
}
