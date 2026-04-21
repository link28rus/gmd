import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/api/api_exceptions.dart';
import '../../core/api/child_api.dart';
import '../../core/api/dio_client.dart';
import '../../core/storage/secure_storage_service.dart';

enum ClaimStatus { idle, inProgress, success, error }

class ClaimState {
  const ClaimState({required this.status, this.childName, this.errorMessage});
  final ClaimStatus status;
  final String? childName;
  final String? errorMessage;
}

/// Device metadata required by `/child/claim`. Injectable so unit tests don't
/// hit the platform channels used by `device_info_plus` / `package_info_plus`.
class DeviceMetadata {
  const DeviceMetadata({
    required this.deviceName,
    required this.osVersion,
    required this.appVersion,
  });

  final String deviceName;
  final String osVersion;
  final String appVersion;
}

typedef DeviceMetadataLoader = Future<DeviceMetadata> Function();

Future<DeviceMetadata> _defaultDeviceMetadataLoader() async {
  final info = await DeviceInfoPlugin().androidInfo;
  final pkg = await PackageInfo.fromPlatform();
  return DeviceMetadata(
    deviceName: info.model,
    osVersion: 'Android ${info.version.release}',
    appVersion: pkg.version,
  );
}

// Release-build (APK на реальном телефоне) ходит на prod через HTTPS-домен.
// Caddy: `handle_path /api/* → backend:3001` стрипает префикс, поэтому baseUrl с `/api`.
// Dev-build (flutter run на эмуляторе) ходит на хост-машину через loopback.
// Переопределить можно через `--dart-define=API_BASE_URL=...`.
const _fallbackApiBaseUrl = kReleaseMode
    ? 'https://gmd.link28rus.ru/api'
    : 'http://10.0.2.2:3001';

const _apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: _fallbackApiBaseUrl,
);

final childApiProvider = Provider<ChildApi>(
  (_) => ChildApi(buildDio(baseUrl: _apiBaseUrl)),
);

final secureStorageProvider =
    Provider<SecureStorageService>((_) => SecureStorageService());

final deviceMetadataProvider =
    Provider<DeviceMetadataLoader>((_) => _defaultDeviceMetadataLoader);

final claimControllerProvider =
    StateNotifierProvider<ClaimController, ClaimState>(
  (ref) => ClaimController(
    api: ref.watch(childApiProvider),
    storage: ref.watch(secureStorageProvider),
    loadMetadata: ref.watch(deviceMetadataProvider),
  ),
);

class ClaimController extends StateNotifier<ClaimState> {
  ClaimController({
    required ChildApi api,
    required SecureStorageService storage,
    required DeviceMetadataLoader loadMetadata,
  })  : _api = api,
        _storage = storage,
        _loadMetadata = loadMetadata,
        super(const ClaimState(status: ClaimStatus.idle));

  final ChildApi _api;
  final SecureStorageService _storage;
  final DeviceMetadataLoader _loadMetadata;

  Future<void> submitCode(String code, {bool consent14Plus = false}) async {
    // Guard against re-entrant calls (e.g. rapid keyboard input or double-tap
    // triggering submitCode twice before the first completes).
    if (state.status == ClaimStatus.inProgress) return;
    state = const ClaimState(status: ClaimStatus.inProgress);
    try {
      final meta = await _loadMetadata();
      // `mounted` guard: if the ProviderContainer was disposed mid-await
      // (e.g. user navigated away), stop mutating state to avoid
      // StateNotifier errors.
      if (!mounted) return;
      final resp = await _api.claim(
        code: code,
        deviceName: meta.deviceName,
        osVersion: meta.osVersion,
        appVersion: meta.appVersion,
        consent14Plus: consent14Plus,
      );
      if (!mounted) return;
      await _storage.saveDeviceToken(resp.deviceToken);
      if (!mounted) return;
      state =
          ClaimState(status: ClaimStatus.success, childName: resp.childName);
    } on ApiException catch (e) {
      if (!mounted) return;
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    } catch (_) {
      if (!mounted) return;
      state = const ClaimState(
        status: ClaimStatus.error,
        errorMessage: 'Неизвестная ошибка. Попробуйте ещё раз.',
      );
    }
  }

  void reset() => state = const ClaimState(status: ClaimStatus.idle);
}
