import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/native/location_service_channel.dart';
import '../claim/claim_controller.dart';

// Ingestor/Drift/Connectivity-логика перенесена в headless Dart-изолят
// LocationForegroundService (lib/background/location_entry.dart), чтобы
// локации, батарея и связь уходили на сервер даже когда UI закрыт / процесс
// убит системой / после ребута. UI-изолят только запускает service и не
// держит ссылок на БД.
final serviceChannelProvider =
    Provider<LocationServiceChannel>((_) => LocationServiceChannel());

// Инициализация home-экрана: стартуем foreground-сервис + проверяем, что
// deviceToken не отозван на сервере (родитель удалил ребёнка / сделал reset).
// Если токен отозван — возвращаем false, home перенаправит на /onboarding.
final homeInitProvider = FutureProvider<HomeInitResult>((ref) async {
  // Параллельно — старт сервиса и проверка токена. Если токен отозван,
  // сервис всё равно запустится (it's ok), но ingest будет безнадёжным.
  // Home сделает redirect, после reclaim всё заведётся.
  unawaited(ref.watch(serviceChannelProvider).startService());

  final storage = ref.watch(secureStorageProvider);
  final token = await storage.readDeviceToken();
  if (token == null || token.isEmpty) {
    return const HomeInitResult(tokenValid: false);
  }

  final api = ref.watch(childApiProvider);
  final me = await api.fetchMe(token);
  if (!me.tokenValid) {
    // Токен отозван сервером — чистим secure storage, чтобы на следующем
    // старте hasToken=false и main.dart повёл на /onboarding.
    await storage.clearAll();
    // Параллельно стопаем foreground сервис — он уже без токена бесполезен.
    unawaited(ref.watch(serviceChannelProvider).stopService());
  }
  return HomeInitResult(tokenValid: me.tokenValid, familyName: me.familyName);
});

class HomeInitResult {
  const HomeInitResult({required this.tokenValid, this.familyName});
  final bool tokenValid;
  final String? familyName;
}
