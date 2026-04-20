import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/features/permissions/permissions_wizard.dart';

void main() {
  testWidgets(
    'PermissionsWizardScaffold renders title, description and both buttons',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: PermissionsWizardScaffold(
            stepIndex: 0,
            totalSteps: 4,
            title: 'Test title',
            description: 'Test description body',
            onRequest: () {},
            onSkip: () {},
          ),
        ),
      );

      expect(find.text('Шаг 1 из 4'), findsOneWidget);
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
          stepIndex: 1,
          totalSteps: 4,
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
}
