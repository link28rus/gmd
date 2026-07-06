import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_child/features/permissions/wizard_intro_screen.dart';
import 'package:periscop_child/features/permissions/wizard_steps.dart';

void main() {
  testWidgets('WizardIntroScreen shows step counts and start button',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: WizardIntroScreen()),
    );

    expect(find.text('Осталось выдать разрешения'), findsOneWidget);
    expect(find.text('Начать настройку'), findsOneWidget);

    // Счётчик шагов берётся из kWizardSteps — проверяем, что общее число
    // отражено в тексте.
    expect(
      find.textContaining('Всего $kWizardTotalSteps шагов'),
      findsOneWidget,
    );
  });
}
