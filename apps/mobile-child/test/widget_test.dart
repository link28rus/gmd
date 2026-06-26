import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:periscop_child/app.dart';

void main() {
  testWidgets('App starts on onboarding screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: GmdChildApp()));
    await tester.pumpAndSettle();
    expect(find.text('Привет! Это Перископ'), findsOneWidget);
  });
}
