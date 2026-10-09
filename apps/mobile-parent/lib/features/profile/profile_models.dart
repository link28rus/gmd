import '../zones/zone_format.dart' show apiExceptionOf;

/// v0.76.0: ФИО взрослого в профиле (как в веб-кабинете, `PATCH /me`).
/// ФИО видит семья — список участников, карта, «Найти телефон».
class ProfileName {
  const ProfileName({required this.lastName, required this.firstName, required this.middleName});

  final String lastName;
  final String firstName;
  final String middleName;

  /// Значения формы из `GET /me` → `user`. Частей ФИО нет, а `name` есть
  /// (аккаунты до ФИО при регистрации) — раскладываем «Фамилия Имя Отчество…»;
  /// одно слово считаем именем.
  factory ProfileName.fromUser(Map<String, dynamic> user) {
    String part(String key) => (user[key] as String?) ?? '';
    if (part('lastName').isNotEmpty ||
        part('firstName').isNotEmpty ||
        part('middleName').isNotEmpty) {
      return ProfileName(
        lastName: part('lastName'),
        firstName: part('firstName'),
        middleName: part('middleName'),
      );
    }
    final words = part('name').trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return const ProfileName(lastName: '', firstName: '', middleName: '');
    if (words.length == 1) {
      return ProfileName(lastName: '', firstName: words.first, middleName: '');
    }
    return ProfileName(
      lastName: words[0],
      firstName: words[1],
      middleName: words.skip(2).join(' '),
    );
  }

  /// Тело `PATCH /me`: пробелы по краям обрезаны, пустое отчество — null.
  Map<String, dynamic> toPatch() {
    final middle = middleName.trim();
    return {
      'lastName': lastName.trim(),
      'firstName': firstName.trim(),
      'middleName': middle.isEmpty ? null : middle,
    };
  }
}

/// Данные экрана профиля.
class ProfileData {
  const ProfileData({required this.email, required this.name});

  final String email;
  final ProfileName name;
}

/// Ошибка, понятная человеку; поля проверяет форма тем же `validateMemberName`.
String profileErrorMessage(Object e) {
  final api = apiExceptionOf(e);
  if (api == null) return 'Нет связи с сервером — проверьте интернет и повторите.';
  if (api.status == 400) return 'Проверьте ФИО — недопустимые символы или слишком длинно.';
  return 'Не удалось сохранить профиль. Повторите позже.';
}
