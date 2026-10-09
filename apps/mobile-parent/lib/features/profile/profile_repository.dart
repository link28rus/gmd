import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_models.dart';
import '../../core/providers.dart';
import 'profile_models.dart';

/// v0.76.0: профиль взрослого — `GET /me` и `PATCH /me` с частями ФИО.
class ProfileRepository {
  ProfileRepository(this._dio);

  final Dio _dio;

  Future<ProfileData> load() async {
    final res = await _dio.get<dynamic>('/me');
    final user = ((res.data as Map)['user'] as Map).cast<String, dynamic>();
    return ProfileData(email: user['email'] as String, name: ProfileName.fromUser(user));
  }

  /// Сохранить ФИО; backend собирает `name` «Фамилия Имя Отчество» и отдаёт его.
  Future<String?> save(ProfileName name) async {
    final res = await _dio.patch<dynamic>('/me', data: name.toPatch());
    final user = ((res.data as Map)['user'] as Map).cast<String, dynamic>();
    return user['name'] as String?;
  }
}

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => ProfileRepository(ref.watch(dioProvider)),
);

/// autoDispose — свежие данные при каждом открытии экрана.
final profileProvider = FutureProvider.autoDispose<ProfileData>(
  (ref) => ref.watch(profileRepositoryProvider).load(),
);

/// Новое имя — в storage и в [authSessionProvider] (меню на главном экране).
Future<void> saveSessionUserName(WidgetRef ref, String? name) async {
  final storage = ref.read(secureStorageProvider);
  final userMap = await storage.readUser();
  if (userMap != null) {
    await storage.saveUser({...userMap, 'name': name});
  }
  final current = ref.read(authSessionProvider);
  if (current == null) return;
  // Токены мог обновить interceptor — берём из storage, как saveSessionFamily.
  final access = await storage.readAccessToken();
  final refresh = await storage.readRefreshToken();
  ref.read(authSessionProvider.notifier).state = AuthSession(
    accessToken: (access != null && access.isNotEmpty) ? access : current.accessToken,
    refreshToken: (refresh != null && refresh.isNotEmpty) ? refresh : current.refreshToken,
    user: AuthUser(
      id: current.user.id,
      email: current.user.email,
      role: current.user.role,
      name: name,
    ),
    family: current.family,
  );
}
