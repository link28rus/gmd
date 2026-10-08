import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:periscop_parent/core/api/api_exception.dart';
import 'package:periscop_parent/features/family/family_models.dart';

void main() {
  setUpAll(() => initializeDateFormatting('ru_RU'));

  group('FamilyMembers.fromJson', () {
    test('семья, моя роль, участники с ролями и isMe', () {
      final r = FamilyMembers.fromJson({
        'family': {'id': 'f1', 'name': 'Ивановы'},
        'myRole': 'parent',
        'members': [
          {
            'userId': 'u1',
            'displayName': 'Мама',
            'email': 'mama@example.com',
            'role': 'owner',
            'joinedAt': '2026-10-01T10:00:00.000Z',
            'isMe': false,
          },
          {
            'userId': 'u2',
            'displayName': 'Папа',
            'email': 'papa@example.com',
            'role': 'parent',
            'joinedAt': '2026-10-08T10:00:00.000Z',
            'isMe': true,
          },
        ],
      });
      expect(r.family.id, 'f1');
      expect(r.family.name, 'Ивановы');
      expect(r.myRole, FamilyRole.parent);
      expect(r.iAmOwner, isFalse);
      expect(r.members, hasLength(2));
      expect(r.members.first.isOwner, isTrue);
      expect(r.members.first.role.label, 'Владелец');
      expect(r.members.first.joinedAt, isNotNull);
      expect(r.members.last.isMe, isTrue);
      expect(r.members.last.role.label, 'Родитель');
    });

    test('неизвестная роль → parent, пустой список', () {
      final r = FamilyMembers.fromJson({
        'family': {'id': 'f1', 'name': 'X'},
        'myRole': 'owner',
      });
      expect(r.iAmOwner, isTrue);
      expect(r.members, isEmpty);
      expect(FamilyRole.parse('admin'), FamilyRole.parent);
    });
  });

  group('MemberInvite', () {
    test('код ABCD-EFGH и текст «Поделиться»', () {
      final i = MemberInvite.fromJson({
        'id': 'i1',
        'code': 'ABCD2345',
        'url': 'https://gmd.link28rus.ru/join/ABCD2345',
        'expiresAt': '2026-10-15T10:00:00.000Z',
        'createdAt': '2026-10-08T10:00:00.000Z',
      });
      expect(i.displayCode, 'ABCD-2345');
      expect(
        i.shareText,
        'Присоединяйся к нашей семье в Перископе: '
        'https://gmd.link28rus.ru/join/ABCD2345 (код ABCD-2345)',
      );
      expect(formatInviteExpiry(i.expiresAt), contains('октября'));
    });
  });

  group('InvitePreview.fromJson', () {
    test('canJoin=true — без причины', () {
      final p = InvitePreview.fromJson({
        'family': {'name': 'Ивановы'},
        'invitedBy': 'Мама',
        'expiresAt': '2026-10-15T10:00:00.000Z',
        'canJoin': true,
      });
      expect(p.canJoin, isTrue);
      expect(p.reason, isNull);
      expect(p.blockedText, isNull);
      expect(p.familyName, 'Ивановы');
      expect(p.invitedBy, 'Мама');
    });

    test('canJoin=false, has_children — число детей в тексте', () {
      final p = InvitePreview.fromJson({
        'family': {'name': 'Ивановы'},
        'invitedBy': 'Мама',
        'expiresAt': '2026-10-15T10:00:00.000Z',
        'canJoin': false,
        'reason': 'has_children',
        'currentFamilyName': 'Петровы',
        'children': 2,
        'members': 0,
      });
      expect(p.canJoin, isFalse);
      expect(p.reason, JoinBlockReason.hasChildren);
      expect(p.children, 2);
      expect(p.blockedText, contains('2 ребёнка'));
      expect(p.blockedText, contains('«Петровы»'));
    });

    test('canJoin=false, has_members — выйти или передать права', () {
      final p = InvitePreview.fromJson({
        'family': {'name': 'Ивановы'},
        'invitedBy': 'Мама',
        'expiresAt': '2026-10-15T10:00:00.000Z',
        'canJoin': false,
        'reason': 'has_members',
        'currentFamilyName': 'Петровы',
        'children': 0,
        'members': 1,
      });
      expect(p.reason, JoinBlockReason.hasMembers);
      expect(p.blockedText, contains('1 другой взрослый'));
      expect(p.blockedText, contains('передайте права'));
    });

    test('canJoin=false, already_member', () {
      final p = InvitePreview.fromJson({
        'family': {'name': 'Ивановы'},
        'invitedBy': 'Мама',
        'expiresAt': '2026-10-15T10:00:00.000Z',
        'canJoin': false,
        'reason': 'already_member',
      });
      expect(p.reason, JoinBlockReason.alreadyMember);
      expect(p.blockedText, 'Вы уже состоите в этой семье.');
    });

    test('неизвестная причина — общий текст', () {
      final p = InvitePreview.fromJson({
        'family': {'name': 'X'},
        'canJoin': false,
        'reason': 'something_new',
      });
      expect(p.reason, JoinBlockReason.unknown);
      expect(p.blockedText, isNotEmpty);
    });
  });

  group('JoinBlockedException.fromErrorBody', () {
    test('409 current_family_not_empty с деталями', () {
      final e = JoinBlockedException.fromErrorBody({
        'error': {
          'code': 'current_family_not_empty',
          'message': '…',
          'reason': 'has_children',
          'currentFamilyName': 'Петровы',
          'children': 5,
          'members': 0,
        },
      });
      expect(e, isNotNull);
      expect(e!.reason, JoinBlockReason.hasChildren);
      expect(e.text, contains('5 детей'));
    });

    test('already_member', () {
      final e = JoinBlockedException.fromErrorBody({
        'error': {'code': 'already_member', 'message': '…'},
      });
      expect(e?.reason, JoinBlockReason.alreadyMember);
    });

    test('другая ошибка — null', () {
      expect(
        JoinBlockedException.fromErrorBody({
          'error': {'code': 'invite_invalid'},
        }),
        isNull,
      );
      expect(JoinBlockedException.fromErrorBody('oops'), isNull);
    });
  });

  group('код приглашения', () {
    test('нормализация: пробелы, дефис, регистр, O/I/L', () {
      expect(normalizeInviteCode(' abcd-2345 '), 'ABCD2345');
      expect(
        normalizeInviteCode('AOIL 2345'),
        'A011'
        '2345',
      );
      expect(isValidInviteCode('abcd-2345'), isTrue);
      expect(isValidInviteCode('ABCD-234'), isFalse);
      expect(isValidInviteCode('ABCD-234U'), isFalse);
      expect(formatInviteCode('ABCD2345'), 'ABCD-2345');
    });
  });

  group('familyErrorMessage', () {
    DioException dioErr(int status, String code) => DioException(
      requestOptions: RequestOptions(path: '/x'),
      error: ApiException(status: status, code: code),
    );

    test('invite_invalid', () {
      expect(
        familyErrorMessage(dioErr(404, 'invite_invalid')),
        'Приглашение не найдено, истекло или уже использовано.',
      );
    });

    test('owner_must_transfer', () {
      expect(familyErrorMessage(dioErr(409, 'owner_must_transfer')), contains('передайте права'));
    });

    test('без ApiException — сеть', () {
      expect(familyErrorMessage(Exception('x')), contains('интернет'));
    });
  });
}
