import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/dio_client.dart';
import 'auth/auth_models.dart';
import 'auth/auth_repository.dart';
import 'fcm/parent_fcm_registrar.dart';
import 'parent_location/parent_location_controller.dart';
import 'parent_location/parent_location_repository.dart';
import 'push/parent_rustore_push_registrar.dart';
import 'storage/secure_storage_service.dart';

final secureStorageProvider = Provider<SecureStorageService>(
  (_) => SecureStorageService(),
);

final dioFactoryProvider = Provider<DioFactory>(
  (ref) => DioFactory(ref.watch(secureStorageProvider)),
);

final dioProvider = Provider<Dio>((ref) {
  final factory = ref.watch(dioFactoryProvider);
  return factory.build();
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    dio: ref.watch(dioProvider),
    storage: ref.watch(secureStorageProvider),
    dioFactory: ref.watch(dioFactoryProvider),
    // v0.70.0: до очистки токенов — остановить геолокацию родителя и удалить
    // её устройство на сервере (DELETE нужен ещё живой JWT).
    beforeLogout: () => ref.read(parentLocationProvider.notifier).onLogout(),
  );
});

/// Текущая сессия (null → не авторизован). Заполняется splash-экраном
/// при наличии токена и login/register-экранами после успешного входа.
final authSessionProvider = StateProvider<AuthSession?>((_) => null);

final parentFcmRegistrarProvider = Provider<ParentFcmRegistrar>((ref) {
  return ParentFcmRegistrar(dio: ref.watch(dioProvider));
});

final parentRuStorePushRegistrarProvider = Provider<ParentRuStorePushRegistrar>((ref) {
  return ParentRuStorePushRegistrar(dio: ref.watch(dioProvider));
});

/// v0.70.0: фоновая геолокация родителя — флаг «показывать меня семье»,
/// разрешения, нативная служба (только Android).
final parentLocationProvider =
    StateNotifierProvider<ParentLocationController, ParentLocationState>((ref) {
  return ParentLocationController(
    repo: ParentLocationRepository(ref.watch(dioProvider)),
    storage: ref.watch(secureStorageProvider),
    currentUserId: () => ref.read(authSessionProvider)?.user.id,
  );
});
