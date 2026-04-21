import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/native/location_service_channel.dart';

// Ingestor/Drift/Connectivity-логика перенесена в headless Dart-изолят
// LocationForegroundService (lib/background/location_entry.dart), чтобы
// локации, батарея и связь уходили на сервер даже когда UI закрыт / процесс
// убит системой / после ребута. UI-изолят только запускает service и не
// держит ссылок на БД.
final serviceChannelProvider =
    Provider<LocationServiceChannel>((_) => LocationServiceChannel());

final homeInitProvider = FutureProvider<void>((ref) async {
  await ref.watch(serviceChannelProvider).startService();
});
