import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:periscop_parent/app.dart';

void main() {
  testWidgets('app boots and shows splash logo', (WidgetTester tester) async {
    // Пустое хранилище: сессии нет, заставка уйдёт на /login.
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const ProviderScope(child: PeriscopParentApp()));
    expect(
      find.image(const AssetImage('assets/icon/icon.png')),
      findsOneWidget,
    );
    expect(find.text('Перископ'), findsOneWidget);
    // Заставка держится минимум 1.8 с — проматываем, чтобы таймер не
    // остался висеть после теста.
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
  });
}
