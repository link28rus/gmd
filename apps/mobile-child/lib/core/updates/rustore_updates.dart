import 'dart:async';

import 'package:flutter_rustore_update/flutter_rustore_update.dart';

import '../diag/diag_channel.dart';

const _tag = 'rustore_updates';

/// v0.51 RuStore In-App Update (lesson #23-24): обёртка над flutter_rustore_update
/// 10.3.0. С v0.50.4 (lesson #26) — единственный канал auto-update: RuStore
/// модерация запретила REQUEST_INSTALL_PACKAGES, поэтому self-hosted ACTION_VIEW
/// installer удалён. На устройствах БЕЗ RuStore client'а (Pixel/AOSP, эмуляторы,
/// установка через self-hosted /download) info()/immediate() кидают — мы это
/// проглатываем и возвращаем false; пользователь обновляется вручную
/// (переустановкой из RuStore Console).
///
/// При установке через RuStore SDK install transport считается как «trusted
/// store update» — MIUI Restricted Settings НЕ сбрасывает AccessibilityService /
/// Device Admin (главная цель этой интеграции, см. lesson #23).
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
      // Immediate flow — модальный полноэкранный диалог; SDK сам качает,
      // верифицирует подпись и устанавливает.
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
