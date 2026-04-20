import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';
import '../features/onboarding/onboarding_screen.dart';

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
        builder: (_, _) => const Scaffold(
          body: Center(child: Text('Claim placeholder')),
        ),
      ),
      GoRoute(
        path: '/home',
        builder: (_, _) => const Scaffold(
          body: Center(child: Text('Home placeholder')),
        ),
      ),
    ],
  );
}
