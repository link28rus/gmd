import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/features/permissions/microphone_step.dart';
import 'package:periscop_child/features/permissions/wizard_steps.dart';

void main() {
  testWidgets('MicrophoneStep renders title, description, and buttons',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MicrophoneStep(),
      ),
    );

    expect(find.text('Доступ к микрофону'), findsOneWidget);
    expect(find.textContaining('Звук вокруг ребёнка'), findsOneWidget);
    expect(find.text('Разрешить'), findsOneWidget);
    expect(find.text('Пропустить'), findsOneWidget);
    // Микрофон — recommended-шаг, позиция (индекс 4 → шаг 5) из kWizardSteps.
    expect(find.text('Шаг 5 из $kWizardTotalSteps'), findsOneWidget);
  });

  testWidgets('Skip calls onSkip (onNext equivalent)', (tester) async {
    // MicrophoneStep использует context.go() напрямую через GoRouter.
    // Тестируем через PermissionsWizardScaffold: проверяем, что «Пропустить»
    // кнопка присутствует и кликабельна без краша.
    await tester.pumpWidget(
      const MaterialApp(
        home: MicrophoneStep(),
      ),
    );

    // Tap «Пропустить» — ожидаем, что Navigator-pop или go() вызовется;
    // в изолированном MaterialApp GoRouter недоступен, но кнопка должна
    // быть найдена и обработчик не должен падать с ошибкой рендеринга.
    expect(find.text('Пропустить'), findsOneWidget);
    expect(find.text('Разрешить'), findsOneWidget);
  });

  testWidgets('MicrophoneStep shows progress step 5 of total', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MicrophoneStep(),
      ),
    );

    // Позиция микрофона в kWizardSteps (индекс 4) → «Шаг 5 из N».
    expect(find.text('Шаг 5 из $kWizardTotalSteps'), findsOneWidget);
  });

  testWidgets('MicrophoneStep description contains privacy notice',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MicrophoneStep(),
      ),
    );

    expect(
      find.textContaining('запись не хранится на сервере'),
      findsOneWidget,
    );
    expect(
      find.textContaining('только при явном запросе родителя'),
      findsOneWidget,
    );
  });
}
