import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/dio_client.dart';
import 'auth/auth_models.dart';
import 'auth/auth_repository.dart';
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
  );
});

/// Текущая сессия (null → не авторизован). Заполняется splash-экраном
/// при наличии токена и login/register-экранами после успешного входа.
final authSessionProvider = StateProvider<AuthSession?>((_) => null);
