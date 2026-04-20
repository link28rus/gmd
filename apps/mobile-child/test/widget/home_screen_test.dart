import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/features/home/home_controller.dart';
import 'package:gmd_child/features/home/home_screen.dart';

void main() {
  testWidgets('HomeScreen renders title + SOS button', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        homeInitProvider.overrideWith((ref) async {}),
      ],
      child: const MaterialApp(home: HomeScreen()),
    ));
    await tester.pump();
    expect(find.text('GMD'), findsOneWidget);
    expect(find.text('Привет!'), findsOneWidget);
    expect(find.text('SOS'), findsOneWidget);
  });
}
