import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/child_api.dart';
import '../../core/native/location_service_channel.dart';
import '../claim/claim_controller.dart';

// Ingestor/Drift/Connectivity-логика перенесена в headless Dart-изолят
// LocationForegroundService (lib/background/location_entry.dart), чтобы
// локации, батарея и связь уходили на сервер даже когда UI закрыт / процесс
// убит системой / после ребута. UI-изолят только запускает service и не
// держит ссылок на БД.
final serviceChannelProvider = Provider<LocationServiceChannel>(
  (_) => LocationServiceChannel(),
);

// Старт при открытии экрана. Повтор /child/me не перезапускает сервис.
final _homeServiceStartProvider = Provider.autoDispose<void>((ref) {
  unawaited(ref.watch(serviceChannelProvider).startService());
});

// При подтверждённой отвязке home перенаправит на /onboarding.
final homeInitProvider = FutureProvider.autoDispose<ChildMeResult>((ref) async {
  ref.watch(_homeServiceStartProvider);
  final service = ref.watch(serviceChannelProvider);
  final storage = ref.watch(secureStorageProvider);
  final api = ref.watch(childApiProvider);
  var disposed = false;
  ref.onDispose(() => disposed = true);

  final token = await storage.readDeviceToken();
  if (token == null || token.isEmpty) {
    return const ChildMeResult(tokenValid: false, serverVerified: false);
  }

  final me = await api.fetchMe(token);
  // Поздний ответ со старого экрана не должен отвязать текущую сессию.
  if (!disposed && !me.tokenValid) {
    // Токен отозван сервером — чистим secure storage, чтобы на следующем
    // старте hasToken=false и main.dart повёл на /onboarding.
    await storage.clearAll();
    // Стопаем foreground сервис и запрещаем автозапуск — без токена он бесполезен.
    unawaited(service.deviceUnlinked());
  }
  return me;
});
