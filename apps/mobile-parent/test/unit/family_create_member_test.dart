import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/core/api/api_exception.dart';
import 'package:periscop_parent/features/family/family_models.dart';

void main() {
  group('generateMemberPassword', () {
    test('12 символов из алфавита без похожих 0/O/o/1/l/I', () {
      final rnd = Random(42);
      for (var i = 0; i < 500; i++) {
        final p = generateMemberPassword(random: rnd);
        expect(p, hasLength(12));
        for (final ch in p.split('')) {
          expect(memberPasswordAlphabet.contains(ch), isTrue, reason: 'символ $ch в $p');
        }
        expect(p, isNot(matches(RegExp('[0O1lIo]'))));
      }
    });

    test('в алфавите нет похожих символов', () {
      for (final ch in ['0', 'O', 'o', '1', 'l', 'I']) {
        expect(memberPasswordAlphabet.contains(ch), isFalse, reason: ch);
      }
    });

    test('есть строчная, заглавная буква и цифра; проходит валидацию', () {
      final rnd = Random(7);
      for (var i = 0; i < 200; i++) {
        final p = generateMemberPassword(random: rnd);
        expect(p, matches(RegExp('[a-z]')));
        expect(p, matches(RegExp('[A-Z]')));
        expect(p, matches(RegExp('[2-9]')));
        expect(validateMemberPassword(p), isNull);
      }
    });

    test('по умолчанию Random.secure, пароли разные', () {
      final set = {for (var i = 0; i < 20; i++) generateMemberPassword()};
      expect(set.length, 20);
    });
  });

  group('валидация полей', () {
    test('пароль 8–128', () {
      expect(validateMemberPassword('1234567'), isNotNull);
      expect(validateMemberPassword('12345678'), isNull);
      expect(validateMemberPassword('a' * 129), isNotNull);
    });

    test('имя обязательно, фамилия нет, без <>"\\', () {
      expect(validateMemberName(' ', required: true), isNotNull);
      expect(validateMemberName('', required: false), isNull);
      expect(validateMemberName('Анна', required: true), isNull);
      expect(validateMemberName('<b>', required: true), isNotNull);
      expect(validateMemberName(r'a\b', required: false), isNotNull);
      // ФИО: фамилия обязательна, свой текст ошибки.
      expect(
        validateMemberName('', required: true, emptyMessage: 'Введите фамилию'),
        'Введите фамилию',
      );
    });

    test('email', () {
      expect(validateMemberEmail('papa@example.com'), isNull);
      expect(validateMemberEmail('papa@'), isNotNull);
      expect(validateMemberEmail(''), isNotNull);
    });
  });

  group('createMemberErrorMessage', () {
    DioException dioErr(int status, String? code) => DioException(
      requestOptions: RequestOptions(path: '/family/members'),
      error: ApiException(status: status, code: code),
      type: DioExceptionType.badResponse,
    );

    test('409 email_taken → отправьте приглашение', () {
      expect(
        createMemberErrorMessage(dioErr(409, 'email_taken')),
        'Этот email уже зарегистрирован в Перископе — отправьте человеку приглашение.',
      );
    });

    test('403 forbidden → только владелец', () {
      expect(createMemberErrorMessage(dioErr(403, 'forbidden')), contains('только владелец'));
    });

    test('400 → проверьте поля', () {
      expect(createMemberErrorMessage(dioErr(400, 'validation_failed')), 'Проверьте поля.');
      expect(createMemberErrorMessage(dioErr(400, null)), 'Проверьте поля.');
    });

    test('сеть → общий текст', () {
      expect(createMemberErrorMessage(Exception('boom')), contains('Нет связи'));
    });
  });

  test('текст данных для входа', () {
    final t = memberCredentialsText(
      email: 'papa@example.com',
      password: 'Abc23456xyzQ',
      origin: 'https://example.ru',
    );
    expect(
      t,
      'Вход в Перископ: https://example.ru/login или приложение родителя — '
      'email: papa@example.com, пароль: Abc23456xyzQ. '
      'Политику конфиденциальности примете при первом входе.',
    );
  });
}
