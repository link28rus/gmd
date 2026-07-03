import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:periscop_parent/app.dart';

void main() {
  testWidgets('app boots and shows splash logo', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: PeriscopParentApp()));
    expect(find.byType(FlutterLogo), findsOneWidget);
  });
}
