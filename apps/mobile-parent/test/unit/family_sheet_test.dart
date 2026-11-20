import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:periscop_parent/features/children/child_models.dart';
import 'package:periscop_parent/features/home/family_sheet.dart';
import 'package:periscop_parent/features/zones/zone_models.dart';

void main() {
  testWidgets('карточка на карте открывает контроль выбранного ребёнка', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final child = Child(id: 'child-2', name: 'Маша & Саша');
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => Scaffold(
            body: MemberCard.kid(
              child: child,
              point: const FamilyLatestPoint(
                childId: 'child-2',
                lat: 43,
                lon: 132,
                ageSec: 30,
              ),
              onClose: () {},
            ),
          ),
          routes: [
            GoRoute(
              path: 'child/:id/parental-control',
              builder: (context, state) => Scaffold(
                body: Text(
                  '${state.pathParameters['id']} / '
                  '${state.uri.queryParameters['name']}',
                ),
              ),
            ),
          ],
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ProviderScope(child: MaterialApp.router(routerConfig: router)),
    );
    await tester.pumpAndSettle();

    final control = find.text('Родительский контроль');
    expect(control, findsOneWidget);
    await tester.tap(control);
    await tester.pumpAndSettle();

    expect(find.text('child-2 / Маша & Саша'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
