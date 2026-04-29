import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_models.dart';
import '../../core/auth/auth_repository.dart';
import '../../core/providers.dart';

/// Заставка: восстанавливает сессию из secure storage и решает /home vs /login.
///
/// Flow:
/// 1. Если в storage нет refresh-токена → /login.
/// 2. Превентивный refresh — гарантирует свежий accessToken на момент входа в /home,
///    либо явный редирект на /login если refresh expired/revoked сервером.
/// 3. Offline / 5xx / timeout → пускаем на /home со старыми токенами,
///    AuthInterceptor разрулит на первом запросе через 401-loop.
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
    final refresh = await storage.readRefreshToken();
    if (refresh == null || refresh.isEmpty) {
      _go('/login');
      return;
    }

    final result = await ref.read(authRepositoryProvider).refreshSession();
    if (result == RefreshResult.rejected) {
      _go('/login');
      return;
    }

    final accessToken = await storage.readAccessToken();
    final userMap = await storage.readUser();
    final familyMap = await storage.readFamily();
    final refreshNow = await storage.readRefreshToken();

    if (accessToken == null ||
        accessToken.isEmpty ||
        userMap == null ||
        familyMap == null ||
        refreshNow == null) {
      _go('/login');
      return;
    }

    ref.read(authSessionProvider.notifier).state = AuthSession(
      accessToken: accessToken,
      refreshToken: refreshNow,
      user: AuthUser.fromJson(userMap),
      family: AuthFamily.fromJson(familyMap),
    );
    _go('/home');
  }

  void _go(String path) {
    if (mounted) context.go(path);
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
