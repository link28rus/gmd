import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../diag/diag_channel.dart';
import 'installer_channel.dart';
import 'update_info.dart';
import 'updates_service.dart';

/// Auto-update mobile-parent — состояние процесса.
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

class UpdateDownloading extends UpdateState {
  const UpdateDownloading({
    required this.info,
    required this.received,
    required this.total,
  });

  final UpdateInfo info;
  final int received;
  final int total;

  double? get progress => total > 0 ? received / total : null;
  int get percent => total > 0 ? ((received / total) * 100).round() : 0;
}

class UpdateDownloaded extends UpdateState {
  const UpdateDownloaded({required this.info, required this.path});

  final UpdateInfo info;
  final String path;
}

class UpdateInstallerLaunched extends UpdateState {
  const UpdateInstallerLaunched({required this.info, required this.path});

  final UpdateInfo info;
  final String path;
}

class UpdateNeedsPermission extends UpdateState {
  const UpdateNeedsPermission({required this.info, required this.path});

  final UpdateInfo info;
  final String path;
}

class UpdateFailed extends UpdateState {
  const UpdateFailed({required this.message, this.info});

  final String message;
  final UpdateInfo? info;
}

/// Контроллер всего цикла. Singleton на app.
class UpdateController extends StateNotifier<UpdateState> {
  UpdateController(this._service) : super(const UpdateIdle());

  final UpdatesService _service;
  bool _autoInstallTried = false;

  // Per-filename флаг «installer уже был запущен в одной из прошлых сессий».
  // Хранится в SharedPreferences (parent не использует flutter_secure_storage —
  // см. lesson в memory-compiler про Android 14/15 MIUI MasterKey loss).
  static const _attemptedKeyPrefix = 'update_installer_attempted_';

  Future<bool> _wasInstallerAttempted(String filename) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool('$_attemptedKeyPrefix$filename') ?? false;
  }

  Future<void> _markInstallerAttempted(String filename) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('$_attemptedKeyPrefix$filename', true);
  }

  Future<void> checkAndAutoInstall() async {
    final s = state;
    if (s is UpdateChecking || s is UpdateDownloading) return;
    state = const UpdateChecking();
    try {
      final info = await _service.checkLatest();
      if (info == null) {
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

  Future<void> retry() async {
    _autoInstallTried = false;
    await checkAndAutoInstall();
  }

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

  Future<void> openInstallSourceSettings() async {
    try {
      await InstallerChannel.openInstallSourceSettings();
    } catch (e) {
      diagLog('updates', 'openInstallSourceSettings failed: $e');
    }
  }

  Future<void> recheckPermissionIfPending() async {
    final s = state;
    if (s is! UpdateNeedsPermission) return;
    final granted = await InstallerChannel.canRequestInstall();
    if (granted) {
      await _tryInstall(info: s.info, path: s.path);
    }
  }

  Future<void> _downloadAndInstall(UpdateInfo info) async {
    final alreadyAttempted = await _wasInstallerAttempted(info.filename);
    state = UpdateDownloading(info: info, received: 0, total: info.sizeBytes);
    try {
      final path = await _service.downloadApk(
        info,
        onProgress: (received, total) {
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

final updatesServiceProvider = Provider<UpdatesService>((ref) {
  return UpdatesService();
});

final updateControllerProvider =
    StateNotifierProvider<UpdateController, UpdateState>((ref) {
  return UpdateController(ref.watch(updatesServiceProvider));
});
