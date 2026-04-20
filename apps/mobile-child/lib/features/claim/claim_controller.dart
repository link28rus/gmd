import 'package:device_info_plus/device_info_plus.dart';
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

final childApiProvider = Provider<ChildApi>(
  (_) => ChildApi(
    buildDio(
      baseUrl: const String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://10.0.2.2:3001',
      ),
    ),
  ),
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
    state = const ClaimState(status: ClaimStatus.inProgress);
    try {
      final meta = await _loadMetadata();
      final resp = await _api.claim(
        code: code,
        deviceName: meta.deviceName,
        osVersion: meta.osVersion,
        appVersion: meta.appVersion,
        consent14Plus: consent14Plus,
      );
      await _storage.saveDeviceToken(resp.deviceToken);
      state =
          ClaimState(status: ClaimStatus.success, childName: resp.childName);
    } on InvalidCodeException catch (e) {
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    } on NetworkException catch (e) {
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    } on ServerException catch (e) {
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    }
  }

  void reset() => state = const ClaimState(status: ClaimStatus.idle);
}
