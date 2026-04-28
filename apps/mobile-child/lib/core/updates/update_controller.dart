import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../diag/diag_channel.dart';
import 'installer_channel.dart';
import 'update_info.dart';
import 'updates_service.dart';

/// v0.40 auto-update — состояние процесса.
@immutable
sealed class UpdateState {
  const UpdateState();
}

/// Начальное состояние, ничего не делали.
class UpdateIdle extends UpdateState {
  const UpdateIdle();
}

/// Идёт запрос /api/public/updates/mobile-child/latest.
class UpdateChecking extends UpdateState {
  const UpdateChecking();
}

/// Backend ответил 204 или версия не новее текущей. UI ничего не показывает.
class UpdateNotNeeded extends UpdateState {
  const UpdateNotNeeded();
}

/// Есть обновление, начали скачивание.
class UpdateDownloading extends UpdateState {
  const UpdateDownloading({
    required this.info,
    required this.received,
    required this.total,
  });

  final UpdateInfo info;
  final int received;
  final int total;

  /// 0..1, или null если total ещё не известен.
  double? get progress => total > 0 ? received / total : null;

  /// 0..100 для UI.
  int get percent => total > 0 ? ((received / total) * 100).round() : 0;
}

/// APK скачан. Сейчас попробуем дёрнуть installer.
class UpdateDownloaded extends UpdateState {
  const UpdateDownloaded({required this.info, required this.path});

  final UpdateInfo info;
  final String path;
}

/// Скачали и системный installer запущен. Если user согласится → app
/// перезапустится, и при следующем check будет UpdateNotNeeded.
/// Если user отменит — кнопка позволит повторить (state переходит обратно
/// в UpdateDownloaded).
class UpdateInstallerLaunched extends UpdateState {
  const UpdateInstallerLaunched({required this.info, required this.path});

  final UpdateInfo info;
  final String path;
}

/// Нет permission REQUEST_INSTALL_PACKAGES. UI показывает кнопку
/// «Разрешить установку обновлений», которая открывает settings.
class UpdateNeedsPermission extends UpdateState {
  const UpdateNeedsPermission({required this.info, required this.path});

  final UpdateInfo info;
  final String path;
}

/// Что-то пошло не так (network, write to disk, installer не открылся).
/// UI показывает кнопку «Повторить».
class UpdateFailed extends UpdateState {
  const UpdateFailed({required this.message, this.info});

  final String message;
  final UpdateInfo? info; // null если упали до получения info
}

/// Контроллер всего цикла. Singleton на app — один instance держит state.
///
/// Вызывается из home_screen на init: `ref.read(updateControllerProvider.notifier).checkAndAutoInstall()`.
/// UI слушает state через `ref.watch(updateControllerProvider)`.
class UpdateController extends StateNotifier<UpdateState> {
  UpdateController(this._service, this._storage) : super(const UpdateIdle());

  final UpdatesService _service;
  final FlutterSecureStorage _storage;
  bool _autoInstallTried = false;

  /// Per-filename флаг «installer уже был запущен в одной из прошлых сессий».
  /// Хранится в encryptedSharedPreferences. Если true — auto-install НЕ запускается
  /// повторно при следующем app-старте, только UI показывает кнопку «Установить»
  /// (UpdateDownloaded), пользователь сам решает.
  ///
  /// Без этого флага auto-install дёргался бы каждый раз когда app открыт и есть
  /// скачанный APK — пользователь видел бы системный диалог установки на каждом
  /// запуске, что раздражает (особенно если он один раз отказался от обновления).
  static const _attemptedKeyPrefix = 'update_installer_attempted_';

  Future<bool> _wasInstallerAttempted(String filename) async {
    final v = await _storage.read(key: '$_attemptedKeyPrefix$filename');
    return v == '1';
  }

  Future<void> _markInstallerAttempted(String filename) async {
    await _storage.write(key: '$_attemptedKeyPrefix$filename', value: '1');
  }

  /// Главный entry-point. Идемпотентно — повторный вызов во время
  /// Downloading / Downloaded ничего не делает.
  Future<void> checkAndAutoInstall() async {
    final s = state;
    // Не запускаем повторно если уже что-то делаем.
    if (s is UpdateChecking || s is UpdateDownloading) return;
    state = const UpdateChecking();
    try {
      final info = await _service.checkLatest();
      if (info == null) {
        // Up-to-date. Чистим cache (старые APK уже не нужны) — это сэкономит
        // место и очистит attempted-флаги при следующем апдейте.
        try {
          await InstallerChannel.cleanupCache();
        } catch (_) {}
        state = const UpdateNotNeeded();
        return;
      }
      await _downloadAndInstall(info);
    } catch (e) {
      diagLog('updates', 'checkAndAutoInstall failed: $e');
      state = UpdateFailed(message: e.toString());
    }
  }

  /// Повторить (для кнопки «Повторить» при UpdateFailed).
  Future<void> retry() async {
    _autoInstallTried = false;
    await checkAndAutoInstall();
  }

  /// Запустить installer вручную (для кнопки «Установить» когда уже скачано).
  Future<void> launchInstaller() async {
    final s = state;
    String path;
    UpdateInfo info;
    if (s is UpdateDownloaded) {
      path = s.path;
      info = s.info;
    } else if (s is UpdateInstallerLaunched) {
      path = s.path;
      info = s.info;
    } else if (s is UpdateNeedsPermission) {
      path = s.path;
      info = s.info;
    } else {
      return;
    }
    await _tryInstall(info: info, path: path);
  }

  /// Открыть settings для гранта REQUEST_INSTALL_PACKAGES.
  Future<void> openInstallSourceSettings() async {
    try {
      await InstallerChannel.openInstallSourceSettings();
    } catch (e) {
      diagLog('updates', 'openInstallSourceSettings failed: $e');
    }
  }

  /// Перепроверить permission (например, после lifecycle resume).
  /// Если granted и есть скачанный APK — попробовать install ещё раз.
  Future<void> recheckPermissionIfPending() async {
    final s = state;
    if (s is! UpdateNeedsPermission) return;
    final granted = await InstallerChannel.canRequestInstall();
    if (granted) {
      await _tryInstall(info: s.info, path: s.path);
    }
  }

  Future<void> _downloadAndInstall(UpdateInfo info) async {
    // Если для этого filename уже был auto-install в прошлой сессии —
    // пользователь либо установил (и тогда мы тут не оказались бы — version
    // совпадает), либо отказался. Не дёргаем installer повторно. Просто
    // покажем UpdateDownloaded — кнопка «Установить» позволит вручную.
    final alreadyAttempted = await _wasInstallerAttempted(info.filename);
    state = UpdateDownloading(info: info, received: 0, total: info.sizeBytes);
    try {
      final path = await _service.downloadApk(
        info,
        onProgress: (received, total) {
          // Throttle setState — слишком частые ребилды UI бессмысленны.
          // Обновляем только при изменении на ≥1% или каждый пакет если total<1MB.
          final s = state;
          if (s is! UpdateDownloading) return;
          final newPct = total > 0 ? ((received / total) * 100).round() : 0;
          final oldPct = s.total > 0 ? ((s.received / s.total) * 100).round() : 0;
          if (newPct != oldPct || total < 1024 * 1024) {
            state = UpdateDownloading(
              info: info,
              received: received,
              total: total > 0 ? total : info.sizeBytes,
            );
          }
        },
      );
      state = UpdateDownloaded(info: info, path: path);
      // Авто-триггер installer ОДИН раз за всю историю этой версии. Если
      // в прошлый раз дёргали и не установилось — пользователь сам нажмёт.
      if (!_autoInstallTried && !alreadyAttempted) {
        _autoInstallTried = true;
        await _markInstallerAttempted(info.filename);
        await _tryInstall(info: info, path: path);
      } else {
        diagLog(
          'updates',
          'auto-install skipped for ${info.filename} (already attempted)',
        );
      }
    } catch (e) {
      diagLog('updates', 'download failed: $e');
      state = UpdateFailed(message: 'Не удалось скачать обновление', info: info);
    }
  }

  Future<void> _tryInstall({
    required UpdateInfo info,
    required String path,
  }) async {
    try {
      final canInstall = await InstallerChannel.canRequestInstall();
      if (!canInstall) {
        diagLog(
          'updates',
          'install: REQUEST_INSTALL_PACKAGES not granted, asking user',
        );
        state = UpdateNeedsPermission(info: info, path: path);
        return;
      }
      final ok = await InstallerChannel.installApk(path);
      if (ok) {
        state = UpdateInstallerLaunched(info: info, path: path);
      } else {
        state = UpdateFailed(
          message: 'Не удалось запустить установщик',
          info: info,
        );
      }
    } catch (e) {
      diagLog('updates', 'install failed: $e');
      state = UpdateFailed(
        message: 'Ошибка установки: $e',
        info: info,
      );
    }
  }
}

/// DI: один UpdatesService на app.
final updatesServiceProvider = Provider<UpdatesService>((ref) {
  return UpdatesService();
});

final _updateStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
});

/// Глобальный контроллер. Lifetime = app, чтобы между переходами
/// home → /debug → home состояние не сбрасывалось.
final updateControllerProvider =
    StateNotifierProvider<UpdateController, UpdateState>((ref) {
  return UpdateController(
    ref.watch(updatesServiceProvider),
    ref.watch(_updateStorageProvider),
  );
});
