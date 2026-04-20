import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:gmd_child/core/storage/secure_storage_service.dart';

class _MockStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late _MockStorage storage;
  late SecureStorageService svc;

  setUp(() {
    storage = _MockStorage();
    svc = SecureStorageService(storage);
  });

  test('saveDeviceToken persists value under device_token key', () async {
    when(() => storage.write(key: 'device_token', value: 'abc'))
        .thenAnswer((_) async {});
    await svc.saveDeviceToken('abc');
    verify(() => storage.write(key: 'device_token', value: 'abc')).called(1);
  });

  test('readDeviceToken returns stored value', () async {
    when(() => storage.read(key: 'device_token'))
        .thenAnswer((_) async => 'abc');
    expect(await svc.readDeviceToken(), 'abc');
  });

  test('readDeviceToken returns null when not stored', () async {
    when(() => storage.read(key: 'device_token'))
        .thenAnswer((_) async => null);
    expect(await svc.readDeviceToken(), isNull);
  });

  test('clearAll deletes all keys', () async {
    when(() => storage.deleteAll()).thenAnswer((_) async {});
    await svc.clearAll();
    verify(() => storage.deleteAll()).called(1);
  });
}
