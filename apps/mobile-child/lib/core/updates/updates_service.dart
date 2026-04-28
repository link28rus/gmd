import 'dart:async';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:dio/dio.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../config/env.dart';
import '../diag/diag_channel.dart';
import 'update_info.dart';

/// v0.40 auto-update — сервис для проверки и скачивания обновлений mobile-child.
///
/// Использует:
///   - PackageInfo.fromPlatform — текущая версия + buildNumber
///   - DeviceInfoPlugin.androidInfo.supportedAbis — выбор ABI APK
///   - Dio — fetch JSON + download APK с прогрессом
///   - PathProvider.getExternalCacheDirectory() + 'updates/' — куда сохранять
///     (тот же путь, что в res/xml/file_provider_paths.xml для FileProvider)
///
/// На non-Android платформах (iOS, web, тесты) `checkLatest` возвращает null —
/// auto-update отключён.
class UpdatesService {
  UpdatesService({Dio? dio}) : _dio = dio ?? Dio();

  final Dio _dio;

  static const _tag = 'updates';

  /// `https://gmd.link28rus.ru/api/public/updates/mobile-child/latest?abi=...`
  String _latestUrl(String abi) =>
      '$apiBaseUrl/public/updates/mobile-child/latest?abi=$abi';

  /// Текущая версия из APK manifest. Возвращает (X.Y.Z, buildNumber-int).
  /// На widget-тестах PackageInfo может бросить → возвращаем null.
  Future<({String version, int? build})?> getCurrentVersion() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final build = int.tryParse(info.buildNumber);
      return (version: info.version, build: build);
    } catch (e) {
      diagLog(_tag, 'getCurrentVersion failed: $e');
      return null;
    }
  }

  /// Главный ABI устройства (первый из SUPPORTED_ABIS).
  /// На non-Android вернёт null → auto-update отключается.
  Future<String?> getDeviceAbi() async {
    if (!Platform.isAndroid) return null;
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      final abis = info.supportedAbis;
      if (abis.isEmpty) return null;
      // Приоритет: arm64-v8a (>99% устройств), потом то что есть.
      if (abis.contains('arm64-v8a')) return 'arm64-v8a';
      if (abis.contains('armeabi-v7a')) return 'armeabi-v7a';
      if (abis.contains('x86_64')) return 'x86_64';
      return abis.first;
    } catch (e) {
      diagLog(_tag, 'getDeviceAbi failed: $e');
      return null;
    }
  }

  /// Запросить latest версию у backend для нашего ABI.
  ///
  /// Возвращает:
  ///   - UpdateInfo если есть НОВЕЕ текущей
  ///   - null если up-to-date / нет APK для abi / network error
  ///
  /// Никогда не throw — все ошибки логируются в DiagLog и возвращают null
  /// (auto-update не должен ломать app старт).
  Future<UpdateInfo?> checkLatest({String? currentVersionRaw}) async {
    final abi = await getDeviceAbi();
    if (abi == null) {
      diagLog(_tag, 'checkLatest: skip (no abi / not android)');
      return null;
    }
    final current = await getCurrentVersion();
    if (current == null) {
      diagLog(_tag, 'checkLatest: skip (no current version)');
      return null;
    }
    final url = _latestUrl(abi);
    final qs = currentVersionRaw != null
        ? '$url&current=${Uri.encodeQueryComponent(currentVersionRaw)}'
        : '$url&current=${current.version}+${current.build ?? 0}';

    try {
      final resp = await _dio.getUri<Map<String, dynamic>>(
        Uri.parse(qs),
        options: Options(
          responseType: ResponseType.json,
          // 204 — валидный «нет апдейта», не throw.
          validateStatus: (s) => s != null && (s == 200 || s == 204),
          receiveTimeout: const Duration(seconds: 10),
          sendTimeout: const Duration(seconds: 10),
        ),
      );
      if (resp.statusCode == 204 || resp.data == null) {
        diagLog(_tag, 'checkLatest: no APK for abi=$abi (204)');
        return null;
      }
      final info = UpdateInfo.fromJson(resp.data!);
      // Сравниваем: текущая X.Y.Z (из PackageInfo) + build (int) vs latest version + buildNumber.
      final currentParsed = ParsedVersion.tryParse(
        '${current.version}+${current.build ?? 0}',
      );
      final latestParsed = ParsedVersion.tryParse(
        '${info.version}+${info.buildNumber ?? 0}',
      );
      if (currentParsed == null || latestParsed == null) {
        diagLog(
          _tag,
          'checkLatest: parse failed current=${current.version}+${current.build} latest=${info.version}+${info.buildNumber}',
        );
        return null;
      }
      if (!latestParsed.isNewerThan(currentParsed)) {
        diagLog(
          _tag,
          'checkLatest: up-to-date (current=${currentParsed.major}.${currentParsed.minor}.${currentParsed.patch}+${currentParsed.build}, latest=${latestParsed.major}.${latestParsed.minor}.${latestParsed.patch}+${latestParsed.build})',
        );
        return null;
      }
      diagLog(
        _tag,
        'checkLatest: UPDATE AVAILABLE current=${current.version}+${current.build} → ${info.version}+${info.buildNumber} (${info.sizeHumanReadable})',
      );
      return info;
    } on DioException catch (e) {
      diagLog(
        _tag,
        'checkLatest dio failed: ${e.type} ${e.response?.statusCode} ${e.message}',
      );
      return null;
    } catch (e) {
      diagLog(_tag, 'checkLatest unexpected: $e');
      return null;
    }
  }

  /// Куда сохраняем APK. Совпадает с external-cache-path/updates/ из
  /// res/xml/file_provider_paths.xml (иначе FileProvider не отдаст URI).
  Future<File> _targetFile(UpdateInfo info) async {
    final cache = await getExternalCacheDirectories();
    if (cache == null || cache.isEmpty) {
      throw StateError('No external cache dir on device');
    }
    final dir = Directory('${cache.first.path}/updates');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return File('${dir.path}/${info.filename}');
  }

  /// Скачать APK с прогрессом. Если файл уже есть и его размер совпадает —
  /// пропускаем download (resume через Range для простоты не делаем).
  ///
  /// [onProgress] вызывается с (received, total) во время загрузки.
  /// Возвращает локальный path к скачанному APK. Throw на ошибках.
  Future<String> downloadApk(
    UpdateInfo info, {
    void Function(int received, int total)? onProgress,
    CancelToken? cancelToken,
  }) async {
    final file = await _targetFile(info);
    if (file.existsSync() && file.lengthSync() == info.sizeBytes) {
      diagLog(
        _tag,
        'downloadApk: cached already (${file.path}, ${info.sizeBytes} bytes) — skip',
      );
      return file.path;
    }
    diagLog(_tag, 'downloadApk: start ${info.url} → ${file.path}');
    try {
      await _dio.download(
        info.url,
        file.path,
        cancelToken: cancelToken,
        onReceiveProgress: onProgress,
        options: Options(
          // APK ~25-30MB, медленный 3G ~10мин — даём 15 мин receive timeout.
          receiveTimeout: const Duration(minutes: 15),
          sendTimeout: const Duration(seconds: 30),
          followRedirects: true,
        ),
      );
      diagLog(
        _tag,
        'downloadApk: done ${file.path} (${file.lengthSync()} bytes, expected ${info.sizeBytes})',
      );
      return file.path;
    } catch (e) {
      // Удаляем частично скачанный файл, иначе следующий заход подумает что он целый.
      try {
        if (file.existsSync()) file.deleteSync();
      } catch (_) {}
      diagLog(_tag, 'downloadApk failed: $e');
      rethrow;
    }
  }
}
