import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:periscop_parent/core/auth/auth_models.dart';
import 'package:periscop_parent/core/providers.dart';
import 'package:periscop_parent/core/storage/secure_storage_service.dart';
import 'package:periscop_parent/features/profile/profile_models.dart';
import 'package:periscop_parent/features/profile/profile_repository.dart';
import 'package:periscop_parent/features/profile/profile_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeRepo extends ProfileRepository {
  _FakeRepo() : super(Dio());

  final saved = <Map<String, dynamic>>[];

  @override
  Future<ProfileData> load() async =>
      ProfileData(email: 'papa@example.test', name: ProfileName.fromUser({'name': 'Папа'}));

  @override
  Future<String?> save(ProfileName name) async {
    final body = name.toPatch();
    saved.add(body);
    return [body['lastName'], body['firstName'], body['middleName']].whereType<String>().join(' ');
  }
}

void main() {
  testWidgets('профиль: подстановка, валидация, сохранение в сессию', (tester) async {
    SharedPreferences.setMockInitialValues({
      'user_json': jsonEncode({'id': 'u1', 'email': 'papa@example.test', 'role': 'owner'}),
    });
    final repo = _FakeRepo();
    final container = ProviderContainer(
      overrides: [
        profileRepositoryProvider.overrideWithValue(repo),
        authSessionProvider.overrideWith(
          (_) => AuthSession(
            accessToken: 'a',
            refreshToken: 'r',
            user: AuthUser(id: 'u1', email: 'papa@example.test', role: 'owner', name: 'Папа'),
            family: AuthFamily(id: 'f1'),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(
          path: '/home',
          builder: (_, _) => const Scaffold(body: Text('home')),
          routes: [GoRoute(path: 'profile', builder: (_, _) => const ProfileScreen())],
        ),
      ],
    );
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.push('/home/profile');
    await tester.pumpAndSettle();

    // Старое имя одним словом — в поле «Имя», email только для чтения
    expect(find.widgetWithText(TextFormField, 'Папа'), findsOneWidget);
    expect(find.text('papa@example.test'), findsOneWidget);

    // Без фамилии не сохраняется
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(find.text('Введите фамилию'), findsOneWidget);
    expect(repo.saved, isEmpty);

    await tester.enterText(find.widgetWithText(TextFormField, 'Фамилия'), ' Тестов ');
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Отчество (необязательно)'),
      'Петрович',
    );
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();

    expect(repo.saved.single, {
      'lastName': 'Тестов',
      'firstName': 'Папа',
      'middleName': 'Петрович',
    });
    expect(find.text('home'), findsOneWidget);
    expect(find.text('Профиль сохранён'), findsOneWidget);
    expect(container.read(authSessionProvider)?.user.name, 'Тестов Папа Петрович');
    final stored = await SecureStorageService().readUser();
    expect(stored?['name'], 'Тестов Папа Петрович');
  });
}
