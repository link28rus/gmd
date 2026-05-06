import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../features/audio/audio_listen_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/child_detail/child_detail_screen.dart';
import '../features/debug/debug_screen.dart';
import '../features/home/home_screen.dart';
import '../features/parental_control/parental_control_screen.dart';
import '../features/splash/splash_screen.dart';

class AppRouter {
  static GoRouter build(WidgetRef ref) {
    final notifier = _AuthRefreshNotifier(ref);
    return GoRouter(
      initialLocation: '/splash',
      refreshListenable: notifier,
      redirect: (context, state) {
        final session = ref.read(authSessionProvider);
        final loc = state.matchedLocation;
        if (loc == '/splash') return null; // splash сам управляет навигацией
        if (loc == '/debug') return null; // /debug доступен всегда — нужен для диагностики login-проблем
        final isAuthRoute = loc == '/login' || loc == '/register';
        if (session == null && !isAuthRoute) return '/login';
        return null;
      },
      routes: [
        GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
        // Скрытый диагностический экран — открывается долгим нажатием на
        // лейбле версии в AppBar /home. Доступен из любого состояния auth,
        // включая когда session == null (для диагностики проблем входа).
        GoRoute(path: '/debug', builder: (_, _) => const DebugScreen()),
        GoRoute(
          path: '/home',
          builder: (_, _) => const HomeScreen(),
          routes: [
            GoRoute(
              path: 'child/:id',
              builder: (_, state) =>
                  ChildDetailScreen(childId: state.pathParameters['id']!),
              routes: [
                GoRoute(
                  // /home/child/:id/audio?name=<urlencoded child name>
                  path: 'audio',
                  builder: (_, state) => AudioListenScreen(
                    childId: state.pathParameters['id']!,
                    childName: state.uri.queryParameters['name'] ?? 'Ребёнок',
                  ),
                ),
                GoRoute(
                  // /home/child/:id/parental-control?name=<urlencoded child name>
                  path: 'parental-control',
                  builder: (_, state) => ParentalControlScreen(
                    childId: state.pathParameters['id']!,
                    childName: state.uri.queryParameters['name'] ?? 'Ребёнок',
                  ),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }
}

/// Пнёт GoRouter перепроверить redirect когда authSession меняется
/// (например после logout — обнулённый state эвакуирует юзера на /login).
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(WidgetRef ref) {
    ref.listen<Object?>(authSessionProvider, (_, _) => notifyListeners());
  }
}
