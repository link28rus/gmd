import 'dart:async';

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
  // Минимальная длительность показа брендовой заставки. Берём максимум из
  // (время bootstrap'а, эта задержка) — не сумму: если восстановление сессии
  // дольше, splash не удлиняется искусственно; если быстрее — держим заставку
  // ~1.8с, чтобы она не «мелькнула».
  static const _minSplash = Duration(milliseconds: 1800);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    // Стартуем восстановление сессии и таймер одновременно, ждём оба (max).
    final routeFuture = _resolveRoute();
    await Future<void>.delayed(_minSplash);
    final route = await routeFuture;
    _go(route);
  }

  /// Решает, куда идти после старта: `/home` (сессия восстановлена) или
  /// `/login`. Никакой навигации внутри — только возврат маршрута.
  Future<String> _resolveRoute() async {
    final storage = ref.read(secureStorageProvider);
    final refresh = await storage.readRefreshToken();
    if (refresh == null || refresh.isEmpty) return '/login';

    final result = await ref.read(authRepositoryProvider).refreshSession();
    if (result == RefreshResult.rejected) return '/login';

    final accessToken = await storage.readAccessToken();
    final userMap = await storage.readUser();
    final familyMap = await storage.readFamily();
    final refreshNow = await storage.readRefreshToken();

    if (accessToken == null ||
        accessToken.isEmpty ||
        userMap == null ||
        familyMap == null ||
        refreshNow == null) {
      return '/login';
    }

    ref.read(authSessionProvider.notifier).state = AuthSession(
      accessToken: accessToken,
      refreshToken: refreshNow,
      user: AuthUser.fromJson(userMap),
      family: AuthFamily.fromJson(familyMap),
    );
    // FCM re-register на каждом старте — токен мог обновиться когда app
    // был выключен. Fire-and-forget, не блокирует переход на /home.
    unawaited(ref.read(parentFcmRegistrarProvider).register());
    // v0.51 (lesson #24): параллельно RuStore Push token.
    unawaited(ref.read(parentRuStorePushRegistrarProvider).register());
    return '/home';
  }

  void _go(String path) {
    if (mounted) context.go(path);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Scaffold(
      backgroundColor: scheme.surface,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(24),
              child: Image.asset(
                'assets/icon/icon.png',
                width: 112,
                height: 112,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Перископ',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Родительский контроль',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 32),
            const CircularProgressIndicator(strokeWidth: 2),
          ],
        ),
      ),
    );
  }
}
