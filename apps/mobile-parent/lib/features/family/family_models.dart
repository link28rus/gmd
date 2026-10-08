import 'dart:math';

import 'package:intl/intl.dart';

import '../../core/api/api_exception.dart';
import '../../core/config/env.dart';
import '../zones/zone_format.dart' show apiExceptionOf, pluralRu;

/// v0.71.0: участники семьи (docs/superpowers/specs/2026-10-08-family-members.md).

enum FamilyRole {
  owner,
  parent;

  static FamilyRole parse(Object? raw) => raw == 'owner' ? owner : parent;

  String get label => this == owner ? 'Владелец' : 'Родитель';
}

class FamilyInfo {
  const FamilyInfo({required this.id, required this.name});

  final String id;
  final String name;

  factory FamilyInfo.fromJson(Map<String, dynamic> json) =>
      FamilyInfo(id: json['id'] as String, name: (json['name'] as String?) ?? '');
}

class FamilyMember {
  const FamilyMember({
    required this.userId,
    required this.displayName,
    required this.email,
    required this.role,
    required this.joinedAt,
    required this.isMe,
  });

  final String userId;
  final String displayName;
  final String email;
  final FamilyRole role;
  final DateTime? joinedAt;
  final bool isMe;

  bool get isOwner => role == FamilyRole.owner;

  factory FamilyMember.fromJson(Map<String, dynamic> json) => FamilyMember(
    userId: json['userId'] as String,
    displayName: (json['displayName'] as String?) ?? '',
    email: (json['email'] as String?) ?? '',
    role: FamilyRole.parse(json['role']),
    joinedAt: DateTime.tryParse((json['joinedAt'] as String?) ?? '')?.toLocal(),
    isMe: json['isMe'] == true,
  );
}

/// `GET /family/members`.
class FamilyMembers {
  const FamilyMembers({required this.family, required this.myRole, required this.members});

  final FamilyInfo family;
  final FamilyRole myRole;
  final List<FamilyMember> members;

  bool get iAmOwner => myRole == FamilyRole.owner;

  factory FamilyMembers.fromJson(Map<String, dynamic> json) => FamilyMembers(
    family: FamilyInfo.fromJson(json['family'] as Map<String, dynamic>),
    myRole: FamilyRole.parse(json['myRole']),
    members: ((json['members'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(FamilyMember.fromJson)
        .toList(),
  );
}

/// Приглашение взрослого в семью (одноразовое, 7 дней).
class MemberInvite {
  const MemberInvite({
    required this.id,
    required this.code,
    required this.url,
    required this.expiresAt,
    required this.createdAt,
  });

  final String id;
  final String code;
  final String url;
  final DateTime expiresAt;
  final DateTime? createdAt;

  /// «ABCD-EFGH».
  String get displayCode => formatInviteCode(code);

  /// Текст для системного «Поделиться».
  String get shareText => 'Присоединяйся к нашей семье в Перископе: $url (код $displayCode)';

  factory MemberInvite.fromJson(Map<String, dynamic> json) => MemberInvite(
    id: json['id'] as String,
    code: json['code'] as String,
    url: (json['url'] as String?) ?? '',
    expiresAt: DateTime.parse(json['expiresAt'] as String).toLocal(),
    createdAt: DateTime.tryParse((json['createdAt'] as String?) ?? '')?.toLocal(),
  );
}

enum JoinBlockReason {
  alreadyMember,
  hasChildren,
  hasMembers,
  unknown;

  static JoinBlockReason? parse(Object? raw) => switch (raw) {
    null => null,
    'already_member' => alreadyMember,
    'has_children' => hasChildren,
    'has_members' => hasMembers,
    _ => unknown,
  };
}

/// `GET /family/member-invites/preview?code=`.
class InvitePreview {
  const InvitePreview({
    required this.familyName,
    required this.invitedBy,
    required this.expiresAt,
    required this.canJoin,
    this.reason,
    this.currentFamilyName,
    this.children = 0,
    this.members = 0,
  });

  final String familyName;
  final String invitedBy;
  final DateTime? expiresAt;
  final bool canJoin;
  final JoinBlockReason? reason;
  final String? currentFamilyName;
  final int children;
  final int members;

  /// Почему нельзя присоединиться (null, если можно).
  String? get blockedText => canJoin
      ? null
      : joinBlockedText(
          reason ?? JoinBlockReason.unknown,
          currentFamilyName: currentFamilyName,
          children: children,
          members: members,
        );

  factory InvitePreview.fromJson(Map<String, dynamic> json) {
    final family = json['family'];
    return InvitePreview(
      familyName: family is Map ? (family['name'] as String?) ?? '' : '',
      invitedBy: (json['invitedBy'] as String?) ?? '',
      expiresAt: DateTime.tryParse((json['expiresAt'] as String?) ?? '')?.toLocal(),
      canJoin: json['canJoin'] == true,
      reason: JoinBlockReason.parse(json['reason']),
      currentFamilyName: json['currentFamilyName'] as String?,
      children: (json['children'] as num?)?.toInt() ?? 0,
      members: (json['members'] as num?)?.toInt() ?? 0,
    );
  }
}

/// 409 `current_family_not_empty` / `already_member` при `accept` — с деталями
/// из тела ошибки (их нет в [ApiException]).
class JoinBlockedException implements Exception {
  const JoinBlockedException({
    required this.reason,
    this.currentFamilyName,
    this.children = 0,
    this.members = 0,
  });

  final JoinBlockReason reason;
  final String? currentFamilyName;
  final int children;
  final int members;

  String get text => joinBlockedText(
    reason,
    currentFamilyName: currentFamilyName,
    children: children,
    members: members,
  );

  /// Из `error`-объекта ответа backend (`{code, message, reason, …}`).
  static JoinBlockedException? fromErrorBody(Object? body) {
    if (body is! Map) return null;
    final err = body['error'] is Map ? body['error'] as Map : body;
    final code = err['code'];
    if (code == 'already_member') {
      return const JoinBlockedException(reason: JoinBlockReason.alreadyMember);
    }
    if (code != 'current_family_not_empty') return null;
    return JoinBlockedException(
      reason: JoinBlockReason.parse(err['reason']) ?? JoinBlockReason.unknown,
      currentFamilyName: err['currentFamilyName'] as String?,
      children: (err['children'] as num?)?.toInt() ?? 0,
      members: (err['members'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  String toString() => 'JoinBlockedException($reason)';
}

String _childrenCount(int n) => '$n ${pluralRu(n, 'ребёнок', 'ребёнка', 'детей')}';

String _adultsCount(int n) =>
    '$n ${pluralRu(n, 'другой взрослый', 'других взрослых', 'других взрослых')}';

/// Понятный текст, почему нельзя присоединиться к семье.
String joinBlockedText(
  JoinBlockReason reason, {
  String? currentFamilyName,
  int children = 0,
  int members = 0,
}) {
  final name = (currentFamilyName ?? '').trim();
  final current = name.isEmpty ? 'вашей текущей семье' : 'вашей текущей семье «$name»';
  switch (reason) {
    case JoinBlockReason.alreadyMember:
      return 'Вы уже состоите в этой семье.';
    case JoinBlockReason.hasChildren:
      final count = children > 0 ? _childrenCount(children) : 'дети';
      return 'В $current есть $count. Один человек может состоять только в одной '
          'семье — сначала удалите детей из текущей семьи или попросите пригласить '
          'их в новую семью заново.';
    case JoinBlockReason.hasMembers:
      final count = members > 0 ? _adultsCount(members) : 'другие взрослые';
      return 'В $current есть $count. Сначала выйдите из неё (если вы владелец — '
          'передайте права другому участнику), затем примите приглашение.';
    case JoinBlockReason.unknown:
      return 'Сейчас присоединиться к этой семье нельзя.';
  }
}

/// Код как на сервере (`normalizeInviteCode`): без пробелов и дефисов, верхний
/// регистр. Плюс правило Crockford base32 — похожие буквы O→0, I/L→1 (в кодах
/// их не бывает, а человек мог ввести по ошибке).
String normalizeInviteCode(String raw) => raw
    .replaceAll(RegExp(r'[\s\-]'), '')
    .toUpperCase()
    .replaceAll('O', '0')
    .replaceAll(RegExp('[IL]'), '1');

final _codeRe = RegExp(r'^[0-9A-HJKMNP-TV-Z]{8}$');

bool isValidInviteCode(String raw) => _codeRe.hasMatch(normalizeInviteCode(raw));

/// «ABCDEFGH» → «ABCD-EFGH» (для 8 символов; иначе как есть).
String formatInviteCode(String code) =>
    code.length == 8 ? '${code.substring(0, 4)}-${code.substring(4)}' : code;

/// «15 октября, 14:30».
String formatInviteExpiry(DateTime d) => DateFormat('d MMMM, HH:mm', 'ru_RU').format(d);

/// Текст ошибки операций с семьёй для SnackBar/диалога.
String familyErrorMessage(Object e) {
  if (e is JoinBlockedException) return e.text;
  final api = apiExceptionOf(e);
  if (api == null) return 'Нет связи с сервером — проверьте интернет и повторите.';
  switch (api.code) {
    case 'invite_invalid':
      return 'Приглашение не найдено, истекло или уже использовано.';
    case 'too_many_invites':
      return 'Слишком много активных приглашений — отзовите ненужные.';
    case 'owner_must_transfer':
      return 'Владелец не может выйти — сначала передайте права другому участнику.';
    case 'cannot_remove_self':
      return 'Нельзя удалить себя — используйте «Выйти из семьи».';
    case 'cannot_transfer_to_self':
      return 'Вы уже владелец семьи.';
    case 'forbidden':
      return 'Это может сделать только владелец семьи.';
    case 'not_found':
      return 'Не найдено — возможно, данные уже изменились. Обновите экран.';
    case 'consent_required':
      return 'Нужно принять политику конфиденциальности.';
    case 'validation_failed':
    case 'bad_request':
      return 'Проверьте введённые данные.';
  }
  if (api.status == 401) return 'Сессия истекла — войдите заново.';
  if (api.status == 429) return 'Слишком много попыток — подождите несколько минут.';
  return _withMessage(api);
}

String _withMessage(ApiException api) {
  final msg = api.message?.trim();
  if (msg != null && msg.isNotEmpty && RegExp('[А-Яа-яЁё]').hasMatch(msg)) return msg;
  return 'Не удалось выполнить (ошибка ${api.status}).';
}

// ─── v0.72.0: владелец создаёт аккаунт участнику ────────────────────────

/// Алфавит генератора пароля: без похожих символов 0/O/o, 1/l/I.
const memberPasswordLowercase = 'abcdefghijkmnpqrstuvwxyz';
const memberPasswordUppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const memberPasswordDigits = '23456789';
const memberPasswordAlphabet =
    memberPasswordLowercase + memberPasswordUppercase + memberPasswordDigits;

/// Длина сгенерированного пароля.
const memberPasswordLength = 12;

/// Минимум и максимум пароля — как у регистрации на сервере.
const memberPasswordMin = 8;
const memberPasswordMax = 128;

/// Случайный пароль из [memberPasswordAlphabet] (по умолчанию
/// `Random.secure()`), в нём есть строчная, заглавная буква и цифра.
String generateMemberPassword({Random? random, int length = memberPasswordLength}) {
  final rnd = random ?? Random.secure();
  while (true) {
    final chars = List.generate(
      length,
      (_) => memberPasswordAlphabet[rnd.nextInt(memberPasswordAlphabet.length)],
    );
    final pwd = chars.join();
    final hasAll =
        chars.any(memberPasswordLowercase.contains) &&
        chars.any(memberPasswordUppercase.contains) &&
        chars.any(memberPasswordDigits.contains);
    if (hasAll || length < 3) return pwd;
  }
}

/// Имя/фамилия — как на сервере: без `<>"\`.
final _badNameChars = RegExp(r'[<>"\\]');

/// Ошибка поля имени (null — ок). [required] — для имени, фамилия необязательна.
/// [emptyMessage] — текст для пустого обязательного поля (null — поле необязательное).
String? validateMemberName(
  String? raw, {
  required bool required,
  String emptyMessage = 'Введите имя',
}) {
  final v = (raw ?? '').trim();
  if (v.isEmpty) return required ? emptyMessage : null;
  if (v.length > 80) return 'Не длиннее 80 символов';
  if (_badNameChars.hasMatch(v)) return 'Без символов < > " \\';
  return null;
}

final _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

String? validateMemberEmail(String? raw) {
  final v = (raw ?? '').trim();
  if (v.isEmpty) return 'Введите email';
  if (v.length > 320 || !_emailRe.hasMatch(v)) return 'Проверьте email';
  return null;
}

String? validateMemberPassword(String? raw) {
  final v = raw ?? '';
  if (v.length < memberPasswordMin) return 'Не короче $memberPasswordMin символов';
  if (v.length > memberPasswordMax) return 'Не длиннее $memberPasswordMax символов';
  return null;
}

/// Аккаунт, созданный владельцем, + пароль (показываем один раз).
class CreatedMemberAccount {
  const CreatedMemberAccount({required this.member, required this.email, required this.password});

  final FamilyMember member;
  final String email;
  final String password;

  /// Текст для «Поделиться» / «Копировать».
  String get shareText => memberCredentialsText(email: email, password: password);
}

/// Данные для входа участнику. [origin] — веб-адрес сервиса (по умолчанию
/// [webOrigin] из env).
String memberCredentialsText({
  required String email,
  required String password,
  String origin = webOrigin,
}) =>
    'Вход в Перископ: $origin/login или приложение родителя — email: $email, '
    'пароль: $password. Политику конфиденциальности примете при первом входе.';

/// Текст ошибки `POST /family/members`.
String createMemberErrorMessage(Object e) {
  final api = apiExceptionOf(e);
  if (api != null) {
    if (api.code == 'email_taken') {
      return 'Этот email уже зарегистрирован в Перископе — отправьте человеку приглашение.';
    }
    if (api.code == 'forbidden') return 'Создавать аккаунты может только владелец семьи.';
    if (api.status == 400) return 'Проверьте поля.';
  }
  return familyErrorMessage(e);
}
