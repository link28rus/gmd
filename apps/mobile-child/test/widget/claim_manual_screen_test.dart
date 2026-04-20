import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/core/api/api_exceptions.dart';
import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/core/storage/secure_storage_service.dart';
import 'package:gmd_child/features/claim/claim_controller.dart';
import 'package:gmd_child/features/claim/claim_manual_screen.dart';
import 'package:mocktail/mocktail.dart';

class _MockApi extends Mock implements ChildApi {}

class _MockStorage extends Mock implements SecureStorageService {}

Future<DeviceMetadata> _stubMetadata() async => const DeviceMetadata(
      deviceName: 'Pixel',
      osVersion: 'Android 14',
      appVersion: '0.14.1',
    );

Widget _wrap({
  required ChildApi api,
  required SecureStorageService storage,
}) {
  return ProviderScope(
    overrides: [
      childApiProvider.overrideWithValue(api),
      secureStorageProvider.overrideWithValue(storage),
      deviceMetadataProvider.overrideWithValue(_stubMetadata),
    ],
    child: const MaterialApp(home: ClaimManualScreen()),
  );
}

void main() {
  late _MockApi api;
  late _MockStorage storage;

  setUp(() {
    api = _MockApi();
    storage = _MockStorage();
  });

  testWidgets('renders title and hint (8-char alnum code)', (tester) async {
    await tester.pumpWidget(_wrap(api: api, storage: storage));
    expect(find.text('Введите код'), findsOneWidget);
    expect(find.text('Код покажет мама или папа'), findsOneWidget);
    expect(find.text('6KDM3B1W'), findsOneWidget);
  });

  testWidgets('entering 8-char alnum code triggers submitCode', (tester) async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const InvalidCodeException());

    await tester.pumpWidget(_wrap(api: api, storage: storage));
    await tester.enterText(find.byType(TextField), '6KDM3B1W');
    await tester.pumpAndSettle();

    verify(() => api.claim(
          code: '6KDM3B1W',
          deviceName: 'Pixel',
          osVersion: 'Android 14',
          appVersion: '0.14.1',
          consent14Plus: false,
        )).called(1);
  });

  testWidgets('accepts lowercase + spaces, normalizes before submit',
      (tester) async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const InvalidCodeException());

    await tester.pumpWidget(_wrap(api: api, storage: storage));
    // TextField сам капитализирует на лету; нормализация из claim_code.dart
    // срежет пробелы. submitCode должен получить канонические 8 символов.
    await tester.enterText(find.byType(TextField), '6k dm 3b 1w');
    await tester.pumpAndSettle();

    verify(() => api.claim(
          code: '6KDM3B1W',
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).called(1);
  });

  testWidgets('shows error message when claim fails with invalid code',
      (tester) async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const InvalidCodeException());

    await tester.pumpWidget(_wrap(api: api, storage: storage));
    await tester.enterText(find.byType(TextField), 'AAAAAAAA');
    await tester.pumpAndSettle();

    expect(find.text('Код не найден или истёк'), findsOneWidget);
  });

  testWidgets('does not call API for partial input (< 8 valid chars)',
      (tester) async {
    await tester.pumpWidget(_wrap(api: api, storage: storage));
    await tester.enterText(find.byType(TextField), '6KDM3B1');
    await tester.pumpAndSettle();

    verifyNever(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        ));
  });
}
