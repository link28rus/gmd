import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_models.dart';
import '../../core/auth/auth_repository.dart';
import '../../core/providers.dart';
import '../children/children_providers.dart';
import '../zones/zones_providers.dart';
import 'family_models.dart';
import 'family_repository.dart';

final familyRepositoryProvider = Provider<FamilyRepository>(
  (ref) => FamilyRepository(ref.watch(dioProvider)),
);

/// Участники текущей семьи. autoDispose — живёт, пока открыт экран «Семья».
final familyMembersProvider = FutureProvider.autoDispose<FamilyMembers>((ref) {
  ref.watch(authSessionProvider.select((s) => s?.user.id));
  return ref.watch(familyRepositoryProvider).members();
});

/// Активные приглашения взрослых (запрашивать только владельцу — иначе 403).
final familyInvitesProvider = FutureProvider.autoDispose<List<MemberInvite>>((ref) {
  return ref.watch(familyRepositoryProvider).listInvites();
});

/// Сбросить всё, что закэшировано по текущей семье: дети, карта семьи, зоны,
/// лента зон, участники. Вызывать после смены членства.
void invalidateFamilyData(WidgetRef ref) {
  ref.invalidate(childrenListProvider);
  ref.invalidate(childLatestLocationProvider);
  ref.invalidate(childActiveTrackProvider);
  ref.invalidate(childTripsProvider);
  ref.invalidate(tripPointsProvider);
  ref.invalidate(familyLatestProvider);
  ref.invalidate(zonesListProvider);
  ref.invalidate(zoneSuggestionsProvider);
  ref.invalidate(zoneStatsProvider);
  ref.invalidate(zoneEventsProvider);
  ref.invalidate(familyMembersProvider);
  ref.invalidate(familyInvitesProvider);
}

/// Записать семью и роль в storage и в [authSessionProvider] (без refresh).
Future<void> saveSessionFamily(WidgetRef ref, FamilyInfo family, FamilyRole role) async {
  final storage = ref.read(secureStorageProvider);
  final familyJson = AuthFamily(id: family.id, name: family.name).toJson();
  await storage.saveFamily(familyJson);
  final userMap = await storage.readUser();
  if (userMap != null) {
    await storage.saveUser({...userMap, 'role': role.name});
  }
  final current = ref.read(authSessionProvider);
  if (current == null) return;
  final access = await storage.readAccessToken();
  final refresh = await storage.readRefreshToken();
  ref.read(authSessionProvider.notifier).state = AuthSession(
    accessToken: (access != null && access.isNotEmpty) ? access : current.accessToken,
    refreshToken: (refresh != null && refresh.isNotEmpty) ? refresh : current.refreshToken,
    user: AuthUser(
      id: current.user.id,
      email: current.user.email,
      role: role.name,
      name: current.user.name,
    ),
    family: AuthFamily.fromJson(familyJson),
  );
}

/// После accept / leave / transfer-ownership: принудительный refresh (в JWT
/// новый familyId и роль), семья и роль — в сессию, сброс кэша данных семьи.
///
/// Возвращает false, если сервер отверг refresh-токен — storage уже очищен,
/// сессия обнулена (роутер уведёт на /login). Сетевой сбой refresh не фатален:
/// старый токен backend отклонит 401 `token_stale`, и interceptor DioFactory
/// сам сделает refresh + повтор на следующем запросе.
Future<bool> applyMembershipChange(
  WidgetRef ref, {
  required FamilyInfo family,
  required FamilyRole role,
}) async {
  final result = await ref.read(authRepositoryProvider).refreshSession();
  if (result == RefreshResult.rejected) {
    ref.read(authSessionProvider.notifier).state = null;
    return false;
  }
  await saveSessionFamily(ref, family, role);
  invalidateFamilyData(ref);
  return true;
}
