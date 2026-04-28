/// v0.40 auto-update — модель ответа `GET /api/public/updates/mobile-child/latest`.
class UpdateInfo {
  const UpdateInfo({
    required this.version,
    required this.buildNumber,
    required this.filename,
    required this.url,
    required this.sizeBytes,
    required this.mandatory,
    this.uploadedAt,
  });

  /// "0.39.7" / "0.40.0-rc.1" — без `+N`, для UI.
  final String version;

  /// Flutter versionCode — монотонный, для compare.
  /// null если backend не вернул build (старые APK без `+N` в имени).
  final int? buildNumber;

  /// "gmd-child-0.39.7+4060-arm64-v8a.apk" — для логирования.
  final String filename;

  /// Абсолютный URL для Dio.download.
  final String url;

  /// Для UI «Скачивание... 4.2 MB».
  final int sizeBytes;

  /// Если true — UI обязан показать update без opt-out. На MVP всегда false.
  final bool mandatory;

  /// ISO timestamp.
  final String? uploadedAt;

  factory UpdateInfo.fromJson(Map<String, dynamic> json) => UpdateInfo(
        version: json['version'] as String,
        buildNumber: (json['buildNumber'] as num?)?.toInt(),
        filename: json['filename'] as String,
        url: json['url'] as String,
        sizeBytes: (json['sizeBytes'] as num).toInt(),
        mandatory: json['mandatory'] as bool? ?? false,
        uploadedAt: json['uploadedAt'] as String?,
      );

  String get sizeHumanReadable {
    if (sizeBytes < 1024 * 1024) {
      return '${(sizeBytes / 1024).toStringAsFixed(0)} KB';
    }
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  /// "vX.Y.Z" (если build есть — добавляем "(N)").
  String get displayVersion =>
      buildNumber != null ? 'v$version ($buildNumber)' : 'v$version';
}

/// Парсер X.Y.Z[-prerelease][+build] для сравнения версий.
///
/// Используется для сравнения PackageInfo.version (X.Y.Z, без +N — Flutter
/// кладёт N отдельно в buildNumber) с UpdateInfo.version (X.Y.Z) +
/// PackageInfo.buildNumber (int) с UpdateInfo.buildNumber (int).
class ParsedVersion {
  const ParsedVersion({
    required this.major,
    required this.minor,
    required this.patch,
    required this.prerelease,
    required this.build,
  });

  final int major;
  final int minor;
  final int patch;
  final String? prerelease; // null = stable, "rc.1" = pre-release
  final int? build;

  static final RegExp _re = RegExp(
    r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+(\d+))?$',
  );

  static ParsedVersion? tryParse(String input) {
    final m = _re.firstMatch(input);
    if (m == null) return null;
    return ParsedVersion(
      major: int.parse(m.group(1)!),
      minor: int.parse(m.group(2)!),
      patch: int.parse(m.group(3)!),
      prerelease: m.group(4),
      build: m.group(5) != null ? int.parse(m.group(5)!) : null,
    );
  }

  /// Возвращает >0 если this > other, <0 если this < other, 0 если равны.
  /// Stable > prerelease (1.0.0 > 1.0.0-rc.1).
  /// При равных X.Y.Z и prerelease сравниваем build (Flutter versionCode).
  int compareTo(ParsedVersion other) {
    if (major != other.major) return major - other.major;
    if (minor != other.minor) return minor - other.minor;
    if (patch != other.patch) return patch - other.patch;
    if (prerelease == null && other.prerelease != null) return 1;
    if (prerelease != null && other.prerelease == null) return -1;
    if (prerelease != null && other.prerelease != null) {
      final cmp = prerelease!.compareTo(other.prerelease!);
      if (cmp != 0) return cmp;
    }
    return (build ?? 0) - (other.build ?? 0);
  }

  bool isNewerThan(ParsedVersion other) => compareTo(other) > 0;
}
