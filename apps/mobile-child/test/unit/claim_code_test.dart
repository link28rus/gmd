import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/features/claim/claim_code.dart';

void main() {
  group('normalizeInviteInput', () {
    test('убирает пробелы и дефисы, приводит к верхнему регистру', () {
      expect(normalizeInviteInput('6k dm 3b 1w'), '6KDM3B1W');
      expect(normalizeInviteInput('6K-DM-3B-1W'), '6KDM3B1W');
      expect(normalizeInviteInput('  6KDM3B1W  '), '6KDM3B1W');
    });
  });

  group('extractInviteCode', () {
    test('возвращает канонический код для чистого ввода', () {
      expect(extractInviteCode('6KDM3B1W'), '6KDM3B1W');
      expect(extractInviteCode('6k dm 3b 1w'), '6KDM3B1W');
      expect(extractInviteCode('6K-DM-3B-1W'), '6KDM3B1W');
    });

    test('извлекает код из URL claim-страницы', () {
      expect(
        extractInviteCode('https://periscop.pro/claim/6KDM3B1W'),
        '6KDM3B1W',
      );
      expect(
        extractInviteCode('http://45.67.230.87/claim/NSZMSK7R'),
        'NSZMSK7R',
      );
      expect(
        extractInviteCode('https://example.com/claim/6KDM3B1W?utm=x'),
        '6KDM3B1W',
      );
    });

    test('извлекает код из deep-link periscop://claim/', () {
      expect(extractInviteCode('periscop://claim/6KDM3B1W'), '6KDM3B1W');
    });

    test('null для некорректных входов', () {
      expect(extractInviteCode(null), isNull);
      expect(extractInviteCode(''), isNull);
      expect(extractInviteCode('   '), isNull);
      // 7 символов — недостаточно
      expect(extractInviteCode('6KDM3B1'), isNull);
      // 9 символов — слишком много
      expect(extractInviteCode('6KDM3B1WA'), isNull);
      // содержит I/L/O/U — вне Crockford alphabet
      expect(extractInviteCode('6KDM3IBW'), isNull);
      expect(extractInviteCode('6KDM3OBW'), isNull);
      // посторонние символы
      expect(extractInviteCode('https://other.site/foo'), isNull);
    });
  });
}
