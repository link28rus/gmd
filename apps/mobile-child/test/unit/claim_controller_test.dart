import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:periscop_child/core/api/child_api.dart';
import 'package:periscop_child/core/api/api_exceptions.dart';
import 'package:periscop_child/core/storage/secure_storage_service.dart';
import 'package:periscop_child/features/claim/claim_controller.dart';

class _MockApi extends Mock implements ChildApi {}

class _MockStorage extends Mock implements SecureStorageService {}

Future<DeviceMetadata> _stubMetadata() async => const DeviceMetadata(
      deviceName: 'Pixel 5',
      osVersion: 'Android 14',
      appVersion: '0.13.0',
    );

void main() {
  late _MockApi api;
  late _MockStorage storage;
  late ProviderContainer container;

  setUp(() {
    api = _MockApi();
    storage = _MockStorage();
    container = ProviderContainer(overrides: [
      childApiProvider.overrideWithValue(api),
      secureStorageProvider.overrideWithValue(storage),
      deviceMetadataProvider.overrideWithValue(_stubMetadata),
    ]);
  });

  tearDown(() => container.dispose());

  test('initial state is idle', () {
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.idle);
    expect(state.childName, isNull);
    expect(state.errorMessage, isNull);
  });

  test('successful claim saves device token and sets success state', () async {
    when(() => api.claim(
          code: '123456',
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenAnswer((_) async => ClaimResponse(
          deviceToken: 'tok_x',
          childId: 'c1',
          childName: 'Олег',
          familyId: 'f1',
          deviceId: 'd1',
        ));
    when(() => storage.saveDeviceToken('tok_x')).thenAnswer((_) async {});

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('123456');
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.success);
    expect(state.childName, 'Олег');
    verify(() => storage.saveDeviceToken('tok_x')).called(1);
  });

  test('invalid code sets error state with "не найден" message', () async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const InvalidCodeException());

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('000000');
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.error);
    expect(state.errorMessage, contains('не найден'));
    verifyNever(() => storage.saveDeviceToken(any()));
  });

  test('network error sets error state with network message', () async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const NetworkException('Сеть недоступна'));

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('123456');
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.error);
    expect(state.errorMessage, 'Сеть недоступна');
  });

  test('server error sets error state', () async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const ServerException('Ошибка сервера', 500));

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('123456');
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.error);
    expect(state.errorMessage, 'Ошибка сервера');
  });

  test('concurrent submitCode calls invoke api.claim only once', () async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenAnswer((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 10));
      return ClaimResponse(
        deviceToken: 'tok_x',
        childId: 'c1',
        childName: 'Олег',
        familyId: 'f1',
        deviceId: 'd1',
      );
    });
    when(() => storage.saveDeviceToken(any())).thenAnswer((_) async {});

    final notifier = container.read(claimControllerProvider.notifier);
    final f1 = notifier.submitCode('123456');
    final f2 = notifier.submitCode('123456');
    await Future.wait([f1, f2]);

    verify(() => api.claim(
          code: '123456',
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).called(1);
  });

  test(
      'unexpected exception (TimeoutException) sets error state with generic message',
      () async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(TimeoutException('x'));

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('123456');
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.error);
    expect(state.errorMessage, 'Неизвестная ошибка. Попробуйте ещё раз.');
  });

  test('reset returns state to idle', () async {
    when(() => api.claim(
          code: any(named: 'code'),
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenThrow(const InvalidCodeException());

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('000000');
    expect(container.read(claimControllerProvider).status, ClaimStatus.error);
    notifier.reset();
    expect(container.read(claimControllerProvider).status, ClaimStatus.idle);
  });
}
