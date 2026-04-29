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
