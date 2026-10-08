import 'package:dio/dio.dart';

import 'zone_models.dart';

/// API геозон (спецификация геозон v2, разделы 1.4 и 2.4). `familyId`
/// backend берёт из JWT. Ошибки 4xx приходят DioException с [ApiException]
/// в `error` (см. DioFactory) — текст для UI строит `zoneErrorMessage`.
class ZonesRepository {
  ZonesRepository(this._dio);

  final Dio _dio;

  /// `GET /zones` → массив ZoneDto (с `myPrefs` текущего пользователя).
  Future<List<Zone>> list() async {
    final res = await _dio.get<dynamic>('/zones');
    final data = res.data;
    final list = data is List
        ? data
        : (data is Map<String, dynamic> ? data['items'] as List? ?? const [] : const []);
    return list.whereType<Map<String, dynamic>>().map(Zone.fromJson).toList();
  }

  /// `POST /zones` → ZoneDto. Ошибки: `validation_failed`, `child_not_found`,
  /// `zone_limit_reached`, `timezone_required`, `invalid_timezone`.
  Future<Zone> create(ZoneInput input) async {
    final res = await _dio.post<dynamic>('/zones', data: input.toJson());
    return Zone.fromJson(res.data as Map<String, dynamic>);
  }

  /// `PATCH /zones/:id` — шлём полный набор полей, как кабинет.
  Future<Zone> update(String id, ZoneInput input) async {
    final res = await _dio.patch<dynamic>(
      '/zones/${Uri.encodeComponent(id)}',
      data: input.toJson(),
    );
    return Zone.fromJson(res.data as Map<String, dynamic>);
  }

  /// `DELETE /zones/:id` → 204.
  Future<void> delete(String id) async {
    await _dio.delete<dynamic>('/zones/${Uri.encodeComponent(id)}');
  }

  /// `PUT /zones/:id/my-notifications` — полный набор по всем детям зоны;
  /// ответ — итоговые настройки текущего пользователя.
  Future<List<ZoneChildPrefs>> setMyNotifications(
    String zoneId,
    List<ZoneChildPrefs> items,
  ) async {
    final res = await _dio.put<dynamic>(
      '/zones/${Uri.encodeComponent(zoneId)}/my-notifications',
      data: {'items': items.map((p) => p.toJson()).toList()},
    );
    final data = res.data;
    final list = data is Map<String, dynamic> ? data['items'] as List? ?? const [] : const [];
    return list.whereType<Map<String, dynamic>>().map(ZoneChildPrefs.fromJson).toList();
  }

  /// `GET /zones/events` — порядок (recordedAt desc, id desc), курсор
  /// непрозрачный (`nextCursor` предыдущей страницы).
  Future<ZoneEventsPage> events({
    String? childId,
    String? zoneId,
    String? cursor,
    int limit = 50,
  }) async {
    final res = await _dio.get<dynamic>(
      '/zones/events',
      queryParameters: <String, dynamic>{
        'childId': ?childId,
        'zoneId': ?zoneId,
        'cursor': ?cursor,
        'limit': limit,
      },
    );
    return ZoneEventsPage.fromJson(res.data as Map<String, dynamic>);
  }

  /// `GET /zones/suggestions?tz=` — подсказки мест (дом, школа, до 3 частых).
  /// Места под существующими зонами и скрытые семьёй backend уже исключил.
  Future<List<PlaceSuggestion>> suggestions({String? tz}) async {
    final res = await _dio.get<dynamic>(
      '/zones/suggestions',
      queryParameters: <String, dynamic>{'tz': ?tz},
    );
    final data = res.data;
    final list = data is List ? data : const [];
    return list.whereType<Map<String, dynamic>>().map(PlaceSuggestion.fromJson).toList();
  }

  /// `POST /zones/suggestions/dismiss` → 204. «Больше не показывать» — на
  /// всю семью.
  Future<void> dismissSuggestion(PlaceSuggestion s) async {
    await _dio.post<dynamic>(
      '/zones/suggestions/dismiss',
      data: {'kind': s.kind, 'centerLat': s.centerLat, 'centerLon': s.centerLon},
    );
  }

  /// `GET /zones/:id/stats?tz=` — визиты за 30 дней по детям зоны.
  /// 404 `zone_not_found`.
  Future<ZoneStats> stats(String zoneId, {String? tz}) async {
    final res = await _dio.get<dynamic>(
      '/zones/${Uri.encodeComponent(zoneId)}/stats',
      queryParameters: <String, dynamic>{'tz': ?tz},
    );
    return ZoneStats.fromJson(res.data as Map<String, dynamic>);
  }

  /// `GET /family/locations/latest` — последняя хорошая точка каждого
  /// ребёнка (дети без точек в ответ не попадают) и, с v0.70.0, родителей,
  /// которые показывают себя семье.
  Future<FamilyLatest> familyLatest() async {
    final res = await _dio.get<dynamic>('/family/locations/latest');
    return FamilyLatest.fromJson(res.data);
  }

  /// `PUT /family/locations/watch` → 204. Отметка «смотрю карту» сразу на
  /// всех детей семьи (v0.70.0): о новых точках придёт тихий push.
  Future<void> watchFamilyLocations() async {
    await _dio.put<dynamic>('/family/locations/watch');
  }

  /// `GET /geo/ip-center` — город по IP. 204 (приватный IP, нет в базе, база
  /// не загружена) → null.
  Future<IpCenter?> ipCenter() async {
    final res = await _dio.get<dynamic>('/geo/ip-center');
    final data = res.data;
    if (res.statusCode == 204 || data is! Map<String, dynamic>) return null;
    return IpCenter.fromJson(data);
  }
}
