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
      appVersion: '0.13.0',
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

  testWidgets('renders title and hint', (tester) async {
    await tester.pumpWidget(_wrap(api: api, storage: storage));
    expect(find.text('Введите код'), findsOneWidget);
    expect(find.text('Код покажет мама или папа'), findsOneWidget);
    expect(find.text('000000'), findsOneWidget);
  });

  testWidgets('entering 6-digit code triggers submitCode', (tester) async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const InvalidCodeException());

    await tester.pumpWidget(_wrap(api: api, storage: storage));
    await tester.enterText(find.byType(TextField), '123456');
    await tester.pumpAndSettle();

    verify(() => api.claim(
          code: '123456',
          deviceName: 'Pixel',
          osVersion: 'Android 14',
          appVersion: '0.13.0',
          consent14Plus: false,
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
    await tester.enterText(find.byType(TextField), '000000');
    await tester.pumpAndSettle();

    expect(find.text('Код не найден или истёк'), findsOneWidget);
  });

  testWidgets('does not call API for partial (<6 char) input', (tester) async {
    await tester.pumpWidget(_wrap(api: api, storage: storage));
    await tester.enterText(find.byType(TextField), '12345');
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
