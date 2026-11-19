import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/zones/widgets/zone_places.dart';
import 'package:periscop_parent/features/zones/zone_models.dart';
import 'package:periscop_parent/features/zones/zones_providers.dart';

void main() {
  testWidgets('время в зоне и приложения обновляются при выборе периода', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          zoneStatsProvider.overrideWith((ref, query) async {
            final today = query.period == ZoneStatsPeriod.today;
            return ZoneStats.fromJson({
              'zoneId': query.zoneId,
              'periodDays': today ? 1 : 7,
              'children': [
                {
                  'childId': 'c1',
                  'visits': 1,
                  'totalSec': 5400,
                  'avgSec': 5400,
                  'usage': {
                    'coverage': today ? 'none' : 'partial',
                    'totalSec': today ? 0 : 600,
                    'apps': today
                        ? []
                        : [
                            {
                              'packageName': 'app.video',
                              'appLabel': 'Видео',
                              'seconds': 600,
                            },
                          ],
                  },
                },
              ],
            });
          }),
        ],
        child: const MaterialApp(
          home: Scaffold(
            body: ZoneStatsSection(zoneId: 'z1', kidNames: {'c1': 'Аня'}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('В зоне · 1 ч 30 мин'), findsOneWidget);
    expect(find.text('Экранное время · 10 мин'), findsOneWidget);
    expect(find.text('Видео'), findsOneWidget);
    expect(
      find.text('Данные об активности есть за часть времени в зоне.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Сегодня'));
    await tester.pumpAndSettle();
    expect(
      find.text('Нет данных об использовании приложений в зоне.'),
      findsOneWidget,
    );
    expect(find.text('Видео'), findsNothing);
  });
}
