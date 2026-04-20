import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';
import '../features/claim/claim_manual_screen.dart';
import '../features/claim/claim_screen.dart';
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
        builder: (_, _) => const ClaimScreen(),
      ),
      GoRoute(
        path: '/claim/manual',
        builder: (_, _) => const ClaimManualScreen(),
      ),
      GoRoute(
        path: '/permissions/notifications',
        builder: (_, _) => const Scaffold(
          body: Center(child: Text('Permissions notifications placeholder')),
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
