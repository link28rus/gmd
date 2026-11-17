class PermissionState {
  PermissionState({
    required this.status,
    required this.reportedAt,
    required this.missing,
  });
  final String status;
  final DateTime? reportedAt;
  final List<String> missing;

  factory PermissionState.fromJson(Map<String, dynamic> json) =>
      PermissionState(
        status: json['status'] as String? ?? 'unknown',
        reportedAt: DateTime.tryParse(json['reportedAt'] as String? ?? ''),
        missing: (json['missing'] as List? ?? [])
            .whereType<Map>()
            .map((p) => p['label'])
            .whereType<String>()
            .toList(),
      );

  bool isStaleAt(DateTime now) =>
      reportedAt != null &&
      now.difference(reportedAt!) > const Duration(hours: 18);
  bool get isStale => status == 'stale' || isStaleAt(DateTime.now());
  bool get needsAttention => isStale || status != 'ok';
  String get summary {
    if (isStale) return 'Разрешения: данные устарели';
    if (status == 'unknown' && reportedAt != null) {
      return 'Не все разрешения удалось проверить';
    }
    if (status == 'unknown' || reportedAt == null) {
      return 'Нет отчёта о разрешениях';
    }
    if (missing.isNotEmpty) return 'Отключено: ${missing.join(', ')}';
    return 'Разрешения в порядке';
  }
}
