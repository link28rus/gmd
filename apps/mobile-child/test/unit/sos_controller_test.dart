import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mocktail/mocktail.dart';

import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/core/api/api_exceptions.dart';
import 'package:gmd_child/core/storage/secure_storage_service.dart';
import 'package:gmd_child/features/claim/claim_controller.dart';
import 'package:gmd_child/features/sos/sos_controller.dart';

class _MockApi extends Mock implements ChildApi {}

class _MockStorage extends Mock implements SecureStorageService {}

Position _stubPosition() => Position(
      latitude: 55.75,
      longitude: 37.62,
      timestamp: DateTime.utc(2026, 4, 20, 12),
      accuracy: 10,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );

Future<Position> _stubLocator() async => _stubPosition();

void main() {
  late _MockApi api;
  late _MockStorage storage;
  late ProviderContainer container;

  setUp(() {
    api = _MockApi();
    storage = _MockStorage();
    when(() => storage.readDeviceToken()).thenAnswer((_) async => 'tok_child');
    container = ProviderContainer(overrides: [
      childApiProvider.overrideWithValue(api),
      secureStorageProvider.overrideWithValue(storage),
      positionLocatorProvider.overrideWithValue(_stubLocator),
    ]);
  });

  tearDown(() => container.dispose());

  test('send() happy path transitions idle → sending → success', () async {
    when(() => api.sendSos(
          deviceToken: any(named: 'deviceToken'),
          lat: any(named: 'lat'),
          lon: any(named: 'lon'),
          accuracy: any(named: 'accuracy'),
          recordedAt: any(named: 'recordedAt'),
        )).thenAnswer((_) async => SosResponse(
          sosId: 'sos_123',
          createdAt: DateTime.utc(2026, 4, 20, 12),
        ));

    final notifier = container.read(sosControllerProvider.notifier);
    expect(container.read(sosControllerProvider).status, SosStatus.idle);

    final observed = <SosStatus>[];
    final sub = container.listen<SosState>(
      sosControllerProvider,
      (_, next) => observed.add(next.status),
    );

    await notifier.send();
    sub.close();

    expect(observed, contains(SosStatus.sending));
    final finalState = container.read(sosControllerProvider);
    expect(finalState.status, SosStatus.success);
    expect(finalState.sosId, 'sos_123');
    verify(() => api.sendSos(
          deviceToken: 'tok_child',
          lat: 55.75,
          lon: 37.62,
          accuracy: 10,
          recordedAt: any(named: 'recordedAt'),
        )).called(1);
  });

  test('send() on 429 ends in error state with rate-limit message', () async {
    when(() => api.sendSos(
          deviceToken: any(named: 'deviceToken'),
          lat: any(named: 'lat'),
          lon: any(named: 'lon'),
          accuracy: any(named: 'accuracy'),
          recordedAt: any(named: 'recordedAt'),
        )).thenThrow(const TooManyRequestsException());

    final notifier = container.read(sosControllerProvider.notifier);
    await notifier.send();

    final state = container.read(sosControllerProvider);
    expect(state.status, SosStatus.error);
    expect(state.errorMessage, isNotNull);
    expect(state.errorMessage, contains('часто'));
  });
}
