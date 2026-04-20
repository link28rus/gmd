import 'package:go_router/go_router.dart';
import '../features/claim/claim_manual_screen.dart';
import '../features/claim/claim_screen.dart';
import '../features/home/home_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/permissions/battery_step.dart';
import '../features/permissions/device_admin_step.dart';
import '../features/permissions/location_step.dart';
import '../features/permissions/notifications_step.dart';

class AppRouter {
  static final GoRouter router = GoRouter(
    initialLocation: '/onboarding',
    routes: [
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
        builder: (_, _) => const DeviceAdminPermissionsStep(),
      ),
      GoRoute(
        path: '/home',
        builder: (_, _) => const HomeScreen(),
      ),
    ],
  );
}
