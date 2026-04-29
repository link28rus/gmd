import 'package:go_router/go_router.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/child_detail/child_detail_screen.dart';
import '../features/home/home_screen.dart';
import '../features/splash/splash_screen.dart';

class AppRouter {
  static GoRouter build() => GoRouter(
        initialLocation: '/splash',
        routes: [
          GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
          GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
          GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
          GoRoute(
            path: '/home',
            builder: (_, _) => const HomeScreen(),
            routes: [
              GoRoute(
                path: 'child/:id',
                builder: (_, state) =>
                    ChildDetailScreen(childId: state.pathParameters['id']!),
              ),
            ],
          ),
        ],
      );
}
