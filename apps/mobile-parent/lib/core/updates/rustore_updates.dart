import 'dart:async';

import 'package:flutter_rustore_update/flutter_rustore_update.dart';

import '../diag/diag_channel.dart';

const _tag = 'rustore_updates';

/// v0.51 RuStore In-App Update (lesson #23-24): обёртка над flutter_rustore_update
/// 10.3.0 для mobile-parent. Параллель `apps/mobile-child/lib/core/updates/rustore_updates.dart`.
///
/// На устройстве с RuStore client'ом и установленным из RuStore приложением
/// — immediate update flow. На устройстве без RuStore (или установка через
/// self-hosted /download) — info()/immediate() кидают, мы возвращаем false.
/// С v0.50.4 fallback на ACTION_VIEW удалён (lesson #24): RuStore модерация
/// требует все обновления через store. На устройствах без RuStore client'а
/// пользователь обновляется вручную (переустановкой из RuStore Console).
class RuStoreUpdates {
  /// Проверить и запустить immediate update если RuStore доступен.
  /// Возвращает true если RuStore взял на себя апдейт.
  static Future<bool> tryImmediate() async {
    try {
      final info = await RustoreUpdateClient.info();
      unawaited(diagLog(
        _tag,
        'info: availability=${info.updateAvailability} (${_availabilityLabel(info.updateAvailability)}) '
        'installStatus=${info.installStatus} versionCode=${info.availableVersionCode}',
      ));
      if (info.updateAvailabilityValue != UpdateAvailability.available) {
        return false;
      }
      final result = await RustoreUpdateClient.immediate();
      unawaited(diagLog(_tag, 'immediate code=${result.code}'));
      return result.code == ACTIVITY_RESULT_OK;
    } catch (e) {
      unawaited(diagLog(_tag, 'info/immediate failed: $e'));
      return false;
    }
  }

  static String _availabilityLabel(int v) {
    switch (UpdateAvailability.fromValue(v)) {
      case UpdateAvailability.available:
        return 'AVAILABLE';
      case UpdateAvailability.inProgress:
        return 'IN_PROGRESS';
      case UpdateAvailability.notAvailable:
        return 'NOT_AVAILABLE';
      case UpdateAvailability.unknown:
        return 'UNKNOWN';
    }
  }
}
