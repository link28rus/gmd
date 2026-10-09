import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../features/audio/audio_listen_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/child_detail/child_detail_screen.dart';
import '../features/consent/consent_providers.dart';
import '../features/consent/consent_screen.dart';
import '../features/debug/debug_screen.dart';
import '../features/family/family_screen.dart';
import '../features/family/join_family_screen.dart';
import '../features/home/home_screen.dart';
import '../features/parental_control/parental_control_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/splash/splash_screen.dart';
import '../features/trip_history/trip_history_screen.dart';
import '../features/trip_history/trip_route_screen.dart';
import '../features/children/child_models.dart';
import '../features/zones/zone_editor_screen.dart';
import '../features/zones/zone_events_screen.dart';
import '../features/zones/zones_screen.dart';

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
        // v0.72.0: политика не принята — держим на экране согласия.
        final needConsent =
            session != null && ref.read(consentPendingUserProvider) == session.user.id;
        if (needConsent && loc != '/consent') return '/consent';
        if (!needConsent && loc == '/consent') return session == null ? '/login' : '/home';
        return null;
      },
      routes: [
        GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
        GoRoute(path: '/consent', builder: (_, _) => const ConsentScreen()),
        // Скрытый диагностический экран — открывается долгим нажатием на
        // лейбле версии в AppBar /home. Доступен из любого состояния auth,
        // включая когда session == null (для диагностики проблем входа).
        GoRoute(path: '/debug', builder: (_, _) => const DebugScreen()),
        GoRoute(
          path: '/home',
          builder: (_, _) => const HomeScreen(),
          routes: [
            // v0.76.0: профиль — ФИО взрослого.
            GoRoute(path: 'profile', builder: (_, _) => const ProfileScreen()),
            // v0.71.0: участники семьи (спека 2026-10-08-family-members.md).
            GoRoute(
              path: 'family',
              builder: (_, _) => const FamilyScreen(),
              routes: [
                GoRoute(
                  // /home/family/join/:code — превью приглашения по коду.
                  path: 'join/:code',
                  builder: (_, state) =>
                      JoinFamilyScreen(code: state.pathParameters['code']!),
                ),
              ],
            ),
            // v0.66.0: геозоны (спека геозон v2, раздел 3.1).
            GoRoute(
              path: 'zones',
              builder: (_, _) => const ZonesScreen(),
              routes: [
                GoRoute(
                  // /home/zones/new?lat=&lon=&zoom=&childId= — центр новой
                  // зоны (текущий вид карты или точка ребёнка).
                  // v0.67.0: из подсказки места ещё
                  // &name=&icon=&color=&radius=&childIds=a,b — предзаполнение.
                  path: 'new',
                  builder: (_, state) {
                    final q = state.uri.queryParameters;
                    final childIds = (q['childIds'] ?? '')
                        .split(',')
                        .map((s) => s.trim())
                        .where((s) => s.isNotEmpty)
                        .toList();
                    return ZoneEditorScreen(
                      initialLat: double.tryParse(q['lat'] ?? ''),
                      initialLon: double.tryParse(q['lon'] ?? ''),
                      initialZoom: double.tryParse(q['zoom'] ?? ''),
                      initialChildId: q['childId'],
                      initialName: q['name'],
                      initialIcon: q['icon'],
                      initialColor: q['color'],
                      initialRadius: int.tryParse(q['radius'] ?? ''),
                      initialChildIds: childIds.isEmpty ? null : childIds,
                    );
                  },
                ),
                GoRoute(
                  // /home/zones/events?zoneId=&childId= — сюда же ведёт тап
                  // по push о зоне.
                  path: 'events',
                  builder: (_, state) => ZoneEventsScreen(
                    initialZoneId: state.uri.queryParameters['zoneId'],
                    initialChildId: state.uri.queryParameters['childId'],
                  ),
                ),
                GoRoute(
                  path: ':zoneId/edit',
                  builder: (_, state) =>
                      ZoneEditorScreen(zoneId: state.pathParameters['zoneId']),
                ),
              ],
            ),
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
                GoRoute(
                  // /home/child/:id/history?name=<urlencoded child name>
                  path: 'history',
                  builder: (_, state) => TripHistoryScreen(
                    childId: state.pathParameters['id']!,
                    childName: state.uri.queryParameters['name'] ?? 'Ребёнок',
                  ),
                  routes: [
                    GoRoute(
                      // /home/child/:id/history/:tripId — маршрут поездки.
                      // Trip передаётся через state.extra (для заголовка).
                      path: ':tripId',
                      builder: (_, state) => TripRouteScreen(
                        childId: state.pathParameters['id']!,
                        tripId: state.pathParameters['tripId']!,
                        childName: state.uri.queryParameters['name'] ?? 'Ребёнок',
                        trip: state.extra is Trip ? state.extra as Trip : null,
                      ),
                    ),
                  ],
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
    ref.listen<String?>(consentPendingUserProvider, (_, _) => notifyListeners());
  }
}
