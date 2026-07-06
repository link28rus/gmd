import 'package:go_router/go_router.dart';
import '../features/claim/claim_manual_screen.dart';
import '../features/claim/claim_screen.dart';
import '../features/debug/debug_screen.dart';
import '../features/home/home_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/permissions/activity_recognition_step.dart';
import '../features/permissions/battery_step.dart';
import '../features/permissions/devadmin_step.dart';
import '../features/permissions/location_step.dart';
import '../features/permissions/microphone_step.dart';
import '../features/permissions/notifications_step.dart';
import '../features/permissions/usage_stats_step.dart';
import '../features/permissions/accessibility_step.dart';
import '../features/permissions/overlay_step.dart';
import '../features/permissions/wizard_intro_screen.dart';
import '../features/permissions/wizard_summary_screen.dart';
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
    // Вводный экран мастера — показывается после успешного claim (см.
    // ClaimScreen). Задаёт ожидания и ведёт на первый шаг.
    GoRoute(
      path: '/permissions/intro',
      builder: (_, _) => const WizardIntroScreen(),
    ),
    // Порядок шагов задаётся централизованно в
    // features/permissions/wizard_steps.dart (kWizardSteps). Навигация «дальше»
    // и нумерация вычисляются оттуда — сами GoRoute порядково-независимы.
    // Логический поток: обязательное (notif/location/battery) → защита и
    // контроль (devadmin/accessibility/overlay/usage-stats) → функции
    // (microphone) → опциональное (activity) → summary.
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
    // v0.53: настоящий шаг активации Device Admin (защита от удаления). Раньше
    // здесь был placeholder, а активация всплывала bottom-sheet'ом на home.
    GoRoute(
      path: '/permissions/devadmin',
      builder: (_, _) => const DeviceAdminStep(),
    ),
    // Accessibility (блокировка приложений). Без него a11y service не подключён,
    // и заблокированное приложение не определится.
    GoRoute(
      path: '/permissions/accessibility',
      builder: (_, _) => const AccessibilityStep(),
    ),
    // SYSTEM_ALERT_WINDOW для visual overlay'а. Без него блокировка работает
    // (HOME action), но без экрана «Телефон заблокирован» с таймером.
    GoRoute(
      path: '/permissions/overlay',
      builder: (_, _) => const OverlayStep(),
    ),
    GoRoute(
      path: '/permissions/usage-stats',
      builder: (_, _) => const UsageStatsStep(),
    ),
    GoRoute(
      path: '/permissions/microphone',
      builder: (_, _) => const MicrophoneStep(),
    ),
    GoRoute(
      path: '/permissions/activity',
      builder: (_, _) => const ActivityRecognitionStep(),
    ),
    // Итоговый экран-чеклист после последнего шага мастера.
    GoRoute(
      path: '/permissions/summary',
      builder: (_, _) => const WizardSummaryScreen(),
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
