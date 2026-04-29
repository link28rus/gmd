import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_models.dart';
import '../../core/providers.dart';

/// Заставка: проверяем есть ли валидная сессия, перебрасываем на /home или /login.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    final storage = ref.read(secureStorageProvider);
    final accessToken = await storage.readAccessToken();
    if (accessToken == null || accessToken.isEmpty) {
      if (mounted) context.go('/login');
      return;
    }
    final userMap = await storage.readUser();
    final familyMap = await storage.readFamily();
    final refresh = await storage.readRefreshToken();
    if (userMap == null || familyMap == null || refresh == null) {
      if (mounted) context.go('/login');
      return;
    }
    ref.read(authSessionProvider.notifier).state = AuthSession(
      accessToken: accessToken,
      refreshToken: refresh,
      user: AuthUser.fromJson(userMap),
      family: AuthFamily.fromJson(familyMap),
    );
    if (mounted) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FlutterLogo(size: 96),
            SizedBox(height: 24),
            CircularProgressIndicator(strokeWidth: 2),
          ],
        ),
      ),
    );
  }
}
