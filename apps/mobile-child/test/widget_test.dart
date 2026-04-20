import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmd_child/app.dart';

void main() {
  testWidgets('App renders initial /onboarding placeholder', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: GmdChildApp()));
    await tester.pumpAndSettle();
    expect(find.text('Onboarding placeholder'), findsOneWidget);
  });
}
