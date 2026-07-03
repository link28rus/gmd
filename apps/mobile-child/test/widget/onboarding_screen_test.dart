import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/features/onboarding/onboarding_screen.dart';

void main() {
  testWidgets('OnboardingScreen shows welcome text + connect button', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onConnect: () {})),
    );
    expect(find.text('Привет! Это Перископ'), findsOneWidget);
    expect(find.textContaining('Нужно подключиться к семье'), findsOneWidget);
    expect(find.text('Подключиться'), findsOneWidget);
  });

  testWidgets('tap on Подключиться calls onConnect', (tester) async {
    var called = false;
    await tester.pumpWidget(
      MaterialApp(home: OnboardingScreen(onConnect: () => called = true)),
    );
    await tester.tap(find.text('Подключиться'));
    await tester.pumpAndSettle();
    expect(called, isTrue);
  });
}
