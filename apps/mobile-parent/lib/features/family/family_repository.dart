import 'package:dio/dio.dart';

import 'family_models.dart';

/// v0.71.0: API участников семьи (docs/superpowers/specs/2026-10-08-family-members.md).
/// Роль backend берёт из БД, не из JWT. Ошибки 4xx приходят DioException с
/// [ApiException] в `error` (см. DioFactory) — текст для UI: [familyErrorMessage].
/// После accept / leave / transfer нужен refresh токена — см.
/// `applyMembershipChange` в family_providers.dart.
class FamilyRepository {
  FamilyRepository(this._dio);

  final Dio _dio;

  /// `GET /family/members` — владелец первым.
  Future<FamilyMembers> members() async {
    final res = await _dio.get<dynamic>('/family/members');
    return FamilyMembers.fromJson(res.data as Map<String, dynamic>);
  }

  /// `PATCH /family/:id` `{name}` — только владелец.
  Future<FamilyInfo> rename(String familyId, String name) async {
    final res = await _dio.patch<dynamic>(
      '/family/${Uri.encodeComponent(familyId)}',
      data: {'name': name},
    );
    final data = res.data as Map<String, dynamic>;
    return FamilyInfo.fromJson(data['family'] as Map<String, dynamic>);
  }

  /// `POST /family/member-invites` — только владелец. Ошибки: `forbidden`,
  /// `too_many_invites` (409, не больше 10 активных).
  Future<MemberInvite> createInvite() async {
    final res = await _dio.post<dynamic>('/family/member-invites');
    final data = res.data as Map<String, dynamic>;
    return MemberInvite.fromJson(data['invite'] as Map<String, dynamic>);
  }

  /// `GET /family/member-invites` — активные приглашения (только владелец).
  Future<List<MemberInvite>> listInvites() async {
    final res = await _dio.get<dynamic>('/family/member-invites');
    final data = res.data;
    final list = data is Map<String, dynamic> ? data['invites'] as List? ?? const [] : const [];
    return list.whereType<Map<String, dynamic>>().map(MemberInvite.fromJson).toList();
  }

  /// `DELETE /family/member-invites/:id` → 204; 404 `not_found`.
  Future<void> revokeInvite(String id) async {
    await _dio.delete<dynamic>('/family/member-invites/${Uri.encodeComponent(id)}');
  }

  /// `GET /family/member-invites/preview?code=` — 404 `invite_invalid`.
  Future<InvitePreview> preview(String code) async {
    final res = await _dio.get<dynamic>(
      '/family/member-invites/preview',
      queryParameters: {'code': normalizeInviteCode(code)},
    );
    return InvitePreview.fromJson(res.data as Map<String, dynamic>);
  }

  /// `POST /family/member-invites/accept` `{code}` → новая семья (роль parent).
  /// 409 `already_member` / `current_family_not_empty` → [JoinBlockedException]
  /// с деталями; 404 `invite_invalid` — как есть.
  Future<FamilyInfo> accept(String code) async {
    try {
      final res = await _dio.post<dynamic>(
        '/family/member-invites/accept',
        data: {'code': normalizeInviteCode(code)},
      );
      final data = res.data as Map<String, dynamic>;
      return FamilyInfo.fromJson(data['family'] as Map<String, dynamic>);
    } on DioException catch (e) {
      final blocked = e.response?.statusCode == 409
          ? JoinBlockedException.fromErrorBody(e.response?.data)
          : null;
      if (blocked != null) throw blocked;
      rethrow;
    }
  }

  /// `DELETE /family/members/:userId` → 204 (только владелец).
  Future<void> removeMember(String userId) async {
    await _dio.delete<dynamic>('/family/members/${Uri.encodeComponent(userId)}');
  }

  /// `POST /family/leave` → новая пустая семья, где я владелец.
  /// 409 `owner_must_transfer`.
  Future<FamilyInfo> leave() async {
    final res = await _dio.post<dynamic>('/family/leave');
    final data = res.data as Map<String, dynamic>;
    return FamilyInfo.fromJson(data['family'] as Map<String, dynamic>);
  }

  /// `POST /family/transfer-ownership` `{userId}` → 204.
  Future<void> transferOwnership(String userId) async {
    await _dio.post<dynamic>('/family/transfer-ownership', data: {'userId': userId});
  }
}
