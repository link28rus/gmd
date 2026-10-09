import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/profile/profile_models.dart';

void main() {
  group('ProfileName.fromUser', () {
    test('берёт сохранённые части ФИО', () {
      final n = ProfileName.fromUser({
        'name': 'x',
        'lastName': 'Иванов',
        'firstName': 'Пётр',
        'middleName': null,
      });
      expect([n.lastName, n.firstName, n.middleName], ['Иванов', 'Пётр', '']);
    });

    test('частей нет — раскладывает name', () {
      final full = ProfileName.fromUser({'name': 'Четверик Нина Александровна'});
      expect(
        [full.lastName, full.firstName, full.middleName],
        ['Четверик', 'Нина', 'Александровна'],
      );
      final one = ProfileName.fromUser({'name': ' Мама '});
      expect([one.lastName, one.firstName, one.middleName], ['', 'Мама', '']);
      final none = ProfileName.fromUser({'name': null});
      expect([none.lastName, none.firstName, none.middleName], ['', '', '']);
    });
  });

  test('toPatch обрезает пробелы, пустое отчество — null', () {
    const n = ProfileName(lastName: ' Иванов ', firstName: 'Пётр', middleName: '  ');
    expect(n.toPatch(), {'lastName': 'Иванов', 'firstName': 'Пётр', 'middleName': null});
  });
}
