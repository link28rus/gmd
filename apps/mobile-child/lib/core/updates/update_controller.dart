import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../diag/diag_channel.dart';
import 'rustore_updates.dart';

/// Состояние авто-обновления. Self-hosted ACTION_VIEW installer удалён
/// (lesson #24, RuStore модерация запретила REQUEST_INSTALL_PACKAGES) —
/// обновления исключительно через `flutter_rustore_update` SDK.
@immutable
sealed class UpdateState {
  const UpdateState();
}

class UpdateIdle extends UpdateState {
  const UpdateIdle();
}

class UpdateChecking extends UpdateState {
  const UpdateChecking();
}

class UpdateNotNeeded extends UpdateState {
  const UpdateNotNeeded();
}

class UpdateFailed extends UpdateState {
  const UpdateFailed({required this.message});

  final String message;
}

/// Контроллер цикла обновления. Делает один call в `RuStoreUpdates.tryImmediate()`
/// — если RuStore доступен и есть обновление, SDK сам покажет модальный экран
/// и установит APK через trusted-store transport (без потери permissions на
/// MIUI/HyperOS, lesson #23). Если RuStore client отсутствует на устройстве —
/// просто переходим в `UpdateNotNeeded`, никаких fallback'ов на ACTION_VIEW.
class UpdateController extends StateNotifier<UpdateState> {
  UpdateController() : super(const UpdateIdle());

  Future<void> checkAndAutoInstall() async {
    final s = state;
    if (s is UpdateChecking) return;
    state = const UpdateChecking();
    try {
      final handed = await RuStoreUpdates.tryImmediate();
      diagLog(
        'updates',
        handed ? 'RuStore handed off update' : 'RuStore: no update / not available',
      );
      state = const UpdateNotNeeded();
    } catch (e) {
      diagLog('updates', 'RuStore tryImmediate threw: $e');
      state = UpdateFailed(message: e.toString());
    }
  }

  Future<void> retry() async {
    await checkAndAutoInstall();
  }
}

final updateControllerProvider =
    StateNotifierProvider<UpdateController, UpdateState>((ref) {
  return UpdateController();
});
