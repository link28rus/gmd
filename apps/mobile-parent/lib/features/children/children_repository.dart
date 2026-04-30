import 'package:dio/dio.dart';

import 'child_models.dart';

class ChildrenRepository {
  ChildrenRepository(this._dio);

  final Dio _dio;

  Future<List<Child>> list() async {
    final res = await _dio.get<dynamic>('/family/children');
    final data = res.data as Map<String, dynamic>;
    final list = (data['children'] as List).cast<Map<String, dynamic>>();
    return list.map(Child.fromJson).toList();
  }

  /// Возвращает null если у ребёнка ещё нет ни одной точки (бэкенд отдаёт 204).
  Future<ChildLocation?> latestLocation(String childId) async {
    final res = await _dio.get<dynamic>('/children/$childId/location/latest');
    if (res.statusCode == 204 || res.data == null) return null;
    return ChildLocation.fromJson(res.data as Map<String, dynamic>);
  }

  /// Точки активной (незакрытой) поездки. Если ребёнок стоит на месте >
  /// TRIP_IDLE_MINUTES — backend вернёт {trip: null, points: []}.
  Future<List<ChildLocation>> activeTrack(String childId) async {
    final res = await _dio.get<dynamic>('/children/$childId/trips/active-track');
    final data = res.data as Map<String, dynamic>;
    final points = (data['points'] as List).cast<Map<String, dynamic>>();
    return points.map(ChildLocation.fromJson).toList();
  }

  /// Отправить ребёнку команду PLAY_SIGNAL — устройство должно громко
  /// проиграть сирену чтобы родитель смог его найти. Backend идемпотентен:
  /// двойной клик в течение TTL вернёт ту же команду + ретрай FCM-push.
  ///
  /// Возможные [ApiException] коды: `child_not_found`, `no_active_device`.
  /// 429 — превышен лимит 6 сигналов в минуту на родителя.
  Future<({String commandId, DateTime expiresAt})> sendSignal(String childId) async {
    final res = await _dio.post<dynamic>('/family/children/$childId/commands/signal');
    final data = res.data as Map<String, dynamic>;
    return (
      commandId: data['commandId'] as String,
      expiresAt: DateTime.parse(data['expiresAt'] as String),
    );
  }

  /// Включить/выключить «защиту от удаления». При enabled=true приложение
  /// ребёнка не должно позволять себя удалить или отключить (Device Admin /
  /// Accessibility-сторож на стороне mobile-child). На MVP backend просто
  /// хранит флаг + рассылает FCM-команду устройству.
  ///
  /// `PATCH /family/children/:id/protection {enabled}` → 200 ProtectionState.
  /// Возможные ошибки: `child_not_found` (404), 4xx/5xx как обычно.
  Future<void> setProtection(String childId, {required bool enabled}) async {
    await _dio.patch<dynamic>(
      '/family/children/$childId/protection',
      data: {'enabled': enabled},
    );
  }

  /// История точек за период. По умолчанию backend отдаёт ~24 часа.
  Future<List<ChildLocation>> locations(
    String childId, {
    DateTime? from,
    DateTime? to,
    int? limit,
  }) async {
    final res = await _dio.get<dynamic>(
      '/children/$childId/locations',
      queryParameters: <String, dynamic>{
        // ignore: use_null_aware_elements
        if (from != null) 'from': from.toUtc().toIso8601String(),
        // ignore: use_null_aware_elements
        if (to != null) 'to': to.toUtc().toIso8601String(),
        // ignore: use_null_aware_elements
        if (limit != null) 'limit': limit,
      },
    );
    final data = res.data as Map<String, dynamic>;
    final points = (data['locations'] as List? ?? data['points'] as List? ?? const [])
        .cast<Map<String, dynamic>>();
    return points.map(ChildLocation.fromJson).toList();
  }
}
