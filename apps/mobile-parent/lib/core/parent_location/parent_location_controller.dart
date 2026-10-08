import 'dart:async';
import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';

import '../api/api_exception.dart';
import '../config/env.dart';
import '../diag/diag_channel.dart';
import '../storage/secure_storage_service.dart';
import 'parent_location_channel.dart';
import 'parent_location_repository.dart';

/// Разрешения, нужные фоновой передаче местоположения родителя.
@immutable
class ParentLocationPermissions {
  const ParentLocationPermissions({
    this.checked = false,
    this.location = false,
    this.always = false,
    this.notifications = false,
    this.battery = false,
  });

  /// Статусы уже прочитаны (до этого карточку шагов не показываем).
  final bool checked;

  /// Геолокация «при использовании» (FINE или COARSE).
  final bool location;

  /// «Разрешать всегда» — нужна, чтобы служба поднималась сама после
  /// перезагрузки, обновления и из сторожа.
  final bool always;
  final bool notifications;

  /// Без ограничений батареи (Doze не душит службу).
  final bool battery;

  bool get allGranted => location && always && notifications && battery;
}

@immutable
class ParentLocationState {
  const ParentLocationState({
    this.enabled,
    this.busy = false,
    this.perms = const ParentLocationPermissions(),
    this.native = ParentLocationNativeStatus.unknown,
  });

  /// Флаг «показывать меня семье» с сервера; null — ещё не знаем (нет сети,
  /// старый сервер без эндпоинта).
  final bool? enabled;

  /// Идёт переключение флага.
  final bool busy;
  final ParentLocationPermissions perms;
  final ParentLocationNativeStatus native;

  ParentLocationState copyWith({
    bool? enabled,
    bool? busy,
    ParentLocationPermissions? perms,
    ParentLocationNativeStatus? native,
  }) => ParentLocationState(
    enabled: enabled ?? this.enabled,
    busy: busy ?? this.busy,
    perms: perms ?? this.perms,
    native: native ?? this.native,
  );
}

/// Фоновая геолокация родителя (v0.70.0): флаг на сервере, токен устройства,
/// разрешения и запуск нативной службы `ParentLocationService`.
///
/// Только Android; на других платформах все методы — no-op.
class ParentLocationController extends StateNotifier<ParentLocationState> {
  ParentLocationController({
    required ParentLocationRepository repo,
    required SecureStorageService storage,
    required String? Function() currentUserId,
  }) : _repo = repo,
       _storage = storage,
       _currentUserId = currentUserId,
       super(const ParentLocationState());

  final ParentLocationRepository _repo;
  final SecureStorageService _storage;
  final String? Function() _currentUserId;

  Future<void>? _syncInFlight;
  /// Идущий запуск: два одновременных вызова (возврат из диалога разрешений
  /// и `resumed`) иначе оба увидят «устройства нет» и зарегистрируют два.
  Future<void>? _startInFlight;

  static bool get _supported => !kIsWeb && Platform.isAndroid;

  void _log(String msg) => unawaited(diagLog('ploc', msg));

  /// При входе и старте приложения: узнать флаг, и если он включён и есть
  /// разрешение на геолокацию — получить токен (если нет), передать нативу и
  /// запустить службу. Параллельные вызовы склеиваются.
  Future<void> sync() {
    if (!_supported) return Future.value();
    return _syncInFlight ??= _doSync().whenComplete(() => _syncInFlight = null);
  }

  Future<void> _doSync() async {
    try {
      await refreshPermissions();
      bool? enabled;
      try {
        enabled = await _repo.getSharing();
      } catch (e) {
        _log('sync: GET sharing failed: $e');
      }
      if (!mounted) return;
      if (enabled == null) {
        // Флаг неизвестен — службу не трогаем, как есть.
        await _refreshNative();
        return;
      }
      state = state.copyWith(enabled: enabled);
      if (enabled) {
        await _startIfReady();
      } else {
        await _stopNative();
      }
    } catch (e) {
      _log('sync failed: $e');
    }
  }

  /// Прочитать статусы разрешений (карточка шагов, перепроверка на resume).
  Future<void> refreshPermissions() async {
    if (!_supported) return;
    try {
      final location = await Permission.locationWhenInUse.status;
      final always = await Permission.locationAlways.status;
      final notifications = await Permission.notification.status;
      final battery = await Permission.ignoreBatteryOptimizations.status;
      if (!mounted) return;
      state = state.copyWith(
        perms: ParentLocationPermissions(
          checked: true,
          location: location.isGranted || location.isLimited,
          always: always.isGranted,
          notifications: notifications.isGranted,
          battery: battery.isGranted,
        ),
      );
    } catch (e) {
      _log('permissions check failed: $e');
    }
  }

  /// После шага разрешений: перечитать статусы и, если можно, запустить службу.
  Future<void> onPermissionsChanged() async {
    if (!_supported) return;
    await refreshPermissions();
    if (state.enabled == true) await _startIfReady();
  }

  /// Тумблер «Показывать меня семье». Ошибку сети пробрасывает (экран
  /// покажет SnackBar), локальное состояние при этом не меняется.
  Future<void> setSharing(bool enabled) async {
    if (!_supported) return;
    state = state.copyWith(busy: true);
    try {
      final result = await _repo.setSharing(enabled);
      if (!mounted) return;
      state = state.copyWith(enabled: result);
      if (result) {
        await refreshPermissions();
        await _startIfReady();
      } else {
        await _stopNative();
      }
    } finally {
      if (mounted) state = state.copyWith(busy: false);
    }
  }

  /// Выход из аккаунта (до очистки токенов — нужен JWT для DELETE):
  /// остановить службу, стереть креды, удалить устройство на сервере.
  Future<void> onLogout() async {
    if (!_supported) return;
    final stored = await _storage.readParentLocationDevice();
    await _clearNative();
    if (stored != null) {
      try {
        await _repo.deleteDevice(stored.deviceId);
      } catch (e) {
        _log('logout: DELETE device failed: $e');
      }
    }
    await _storage.clearParentLocationDevice();
    if (mounted) state = const ParentLocationState();
  }

  /// Сессия протухла (заставка увела на вход) — без JWT удалить устройство
  /// нельзя, просто глушим службу. Запись об устройстве оставляем: тот же
  /// пользователь при входе продолжит с ним.
  Future<void> stopLocal() async {
    if (!_supported) return;
    await _clearNative();
    if (mounted) state = const ParentLocationState();
  }

  Future<void> _startIfReady() =>
      _startInFlight ??= _doStartIfReady().whenComplete(() => _startInFlight = null);

  Future<void> _doStartIfReady() async {
    if (!state.perms.location) {
      _log('start: нет разрешения на геолокацию — ждём шагов на главном экране');
      await _refreshNative();
      return;
    }
    final device = await _ensureDevice();
    if (device == null) {
      await _refreshNative();
      return;
    }
    try {
      await ParentLocationChannel.saveCreds(
        baseUrl: apiBaseUrl,
        token: device.token,
        deviceId: device.deviceId,
        enabled: true,
      );
      final ok = await ParentLocationChannel.start();
      _log('start: native start=$ok device=${device.deviceId}');
    } catch (e) {
      _log('start: native failed: $e');
    }
    await _refreshNative();
  }

  /// Токен устройства текущего пользователя: сохранённый или новый.
  Future<({String deviceId, String token})?> _ensureDevice() async {
    final userId = _currentUserId();
    if (userId == null || userId.isEmpty) return null;
    final stored = await _storage.readParentLocationDevice();
    var native = ParentLocationNativeStatus.unknown;
    try {
      native = await ParentLocationChannel.status();
    } catch (_) {}
    final mine = stored != null && stored.userId == userId;
    if (mine && !native.authFailed) {
      return (deviceId: stored.deviceId, token: stored.token);
    }
    final pkg = await PackageInfo.fromPlatform();
    final appVersion = '${pkg.version}+${pkg.buildNumber}';
    ({String deviceId, String token}) device;
    try {
      device = await _repo.registerDevice(
        platform: 'android',
        appVersion: appVersion,
        replaceDeviceId: mine ? stored.deviceId : null,
      );
    } catch (e) {
      // Прежнее устройство сервер мог уже забыть — регистрируемся без замены.
      if (!mine || !_isClientError(e)) {
        _log('register device failed: $e');
        return null;
      }
      try {
        device = await _repo.registerDevice(platform: 'android', appVersion: appVersion);
      } catch (e2) {
        _log('register device (без замены) failed: $e2');
        return null;
      }
    }
    await _storage.saveParentLocationDevice(
      userId: userId,
      deviceId: device.deviceId,
      token: device.token,
    );
    _log('device registered ${device.deviceId} (replace=${mine ? stored.deviceId : '-'})');
    return device;
  }

  static bool _isClientError(Object e) {
    int? status;
    if (e is ApiException) {
      status = e.status;
    } else if (e is DioException) {
      final err = e.error;
      status = err is ApiException ? err.status : e.response?.statusCode;
    }
    return status != null && status >= 400 && status < 500;
  }

  Future<void> _stopNative() async {
    try {
      await ParentLocationChannel.stop();
    } catch (e) {
      _log('stop: native failed: $e');
    }
    await _refreshNative();
  }

  Future<void> _clearNative() async {
    try {
      await ParentLocationChannel.stop();
      await ParentLocationChannel.clearCreds();
    } catch (e) {
      _log('clear: native failed: $e');
    }
  }

  Future<void> _refreshNative() async {
    try {
      final s = await ParentLocationChannel.status();
      if (mounted) state = state.copyWith(native: s);
    } catch (_) {}
  }
}
