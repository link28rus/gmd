import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/features/permissions/permissions_wizard.dart';
import 'package:periscop_child/features/permissions/wizard_steps.dart';

void main() {
  // Recommended-шаг: у него кнопка «Пропустить» (у mandatory — «Не сейчас»).
  const recommendedRoute = '/permissions/devadmin';
  final recommendedStepNumber = wizardIndexOf(recommendedRoute) + 1;

  testWidgets(
    'PermissionsWizardScaffold renders title, description and both buttons',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: PermissionsWizardScaffold(
            route: recommendedRoute,
            title: 'Test title',
            description: 'Test description body',
            onRequest: () {},
            onSkip: () {},
          ),
        ),
      );

      expect(
        find.text('Шаг $recommendedStepNumber из $kWizardTotalSteps'),
        findsOneWidget,
      );
      expect(find.text('Test title'), findsOneWidget);
      expect(find.text('Test description body'), findsOneWidget);
      expect(find.text('Разрешить'), findsOneWidget);
      expect(find.text('Пропустить'), findsOneWidget);
    },
  );

  testWidgets('onRequest and onSkip callbacks fire on tap', (tester) async {
    var requested = false;
    var skipped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: PermissionsWizardScaffold(
          route: recommendedRoute,
          title: 'T',
          description: 'D',
          onRequest: () => requested = true,
          onSkip: () => skipped = true,
        ),
      ),
    );

    await tester.tap(find.text('Разрешить'));
    await tester.pumpAndSettle();
    expect(requested, isTrue);

    await tester.tap(find.text('Пропустить'));
    await tester.pumpAndSettle();
    expect(skipped, isTrue);
  });

  testWidgets(
    'mandatory step shows «Не сейчас» and confirms before skipping',
    (tester) async {
      var skipped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: PermissionsWizardScaffold(
            route: '/permissions/location', // mandatory
            title: 'Местоположение',
            description: 'D',
            onRequest: () {},
            onSkip: () => skipped = true,
          ),
        ),
      );

      // У обязательного шага нет лёгкой кнопки «Пропустить».
      expect(find.text('Пропустить'), findsNothing);
      expect(find.text('Не сейчас'), findsOneWidget);

      await tester.tap(find.text('Не сейчас'));
      await tester.pumpAndSettle();
      // Показан диалог подтверждения — onSkip ещё не вызван.
      expect(skipped, isFalse);

      await tester.tap(find.text('Всё равно пропустить'));
      await tester.pumpAndSettle();
      expect(skipped, isTrue);
    },
  );
}
