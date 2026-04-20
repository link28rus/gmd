# Phase 3 — mobile-child Flutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить Flutter-приложение для устройства ребёнка с фоновым GPS, SOS, ring-командой от родителя через FCM и защитой от удаления — до релиза v0.13.0.

**Architecture:** Flutter (Dart) + нативный Kotlin foreground service через MethodChannel. Drift локально для offline-очереди точек, flutter_secure_storage для device-token. Новые backend-endpoints для push-token/sos/ring и Prisma-модели SosEvent/RingEvent.

**Tech Stack:** Flutter 3.11+ / Dart 3.x, Riverpod, Dio, Drift, go_router, firebase_messaging, mobile_scanner, Kotlin + FusedLocationProviderClient, NestJS + Prisma, Jest + supertest.

**Spec:** [docs/superpowers/specs/2026-04-20-gmd-phase3-mobile-child-design.md](../specs/2026-04-20-gmd-phase3-mobile-child-design.md)

---

## Prerequisites (блокирующие долги)

### Task P1: Git remote для CI

**Файлы:** внешнее действие, git config

- [ ] **Шаг 1:** Решить GitHub private vs self-hosted Gitea (раздел «Открытые вопросы» CLAUDE.md, пункт 2). Рекомендация — GitHub private для скорости.
- [ ] **Шаг 2:** Создать приватный репозиторий в выбранной системе (`link28rus/gmd`).
- [ ] **Шаг 3:** Настроить локальный `git remote add origin <url>` и запушить historic commits + tags:

```bash
git remote add origin git@github.com:link28rus/gmd.git
git push -u origin main
git push origin --tags
```

- [ ] **Шаг 4:** Сохранить в memory-compiler `save_decision` — «git hosting: <выбрано>».

**Без этого Task нельзя настраивать CI в M1.**

---

## M1 — Flutter skeleton

### Task 1.1: Обновить pubspec.yaml mobile-child

**Файлы:**

- Modify: `apps/mobile-child/pubspec.yaml`

- [ ] **Шаг 1:** Заменить содержимое `pubspec.yaml` на версию со всеми зависимостями из спецификации §3:

```yaml
name: gmd_child
description: 'GMD — приложение ребёнка'
publish_to: 'none'
version: 0.13.0+1

environment:
  sdk: ^3.11.5
  flutter: '>=3.24.0'

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  flutter_riverpod: ^2.6.0
  dio: ^5.7.0
  drift: ^2.20.0
  sqlite3_flutter_libs: ^0.5.24
  path_provider: ^2.1.4
  path: ^1.9.0
  flutter_secure_storage: ^9.2.2
  firebase_core: ^3.6.0
  firebase_messaging: ^15.1.3
  mobile_scanner: ^5.2.3
  permission_handler: ^11.3.1
  geolocator: ^13.0.1
  connectivity_plus: ^6.0.5
  device_info_plus: ^11.1.0
  package_info_plus: ^8.1.0
  go_router: ^14.6.0
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0
  gmd_shared:
    path: ../../packages/shared-dart
  intl: ^0.19.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  integration_test:
    sdk: flutter
  flutter_lints: ^6.0.0
  build_runner: ^2.4.13
  drift_dev: ^2.20.3
  freezed: ^2.5.7
  json_serializable: ^6.8.0
  mocktail: ^1.0.4

flutter:
  uses-material-design: true
```

- [ ] **Шаг 2:** Запустить `cd apps/mobile-child && flutter pub get`. Убедиться — нет ошибок разрешения.
- [ ] **Шаг 3:** Убедиться, что `gmd_shared` package существует и содержит базовые DTO (`ls ../../packages/shared-dart/lib`). Если нет — создать пустой пакет, типы добавятся постепенно.
- [ ] **Шаг 4:** Обновить `melos bootstrap` на корне:

```bash
cd ../../ && melos bootstrap
```

- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/pubspec.yaml apps/mobile-child/pubspec.lock
git commit -m "feat(mobile-child): add Phase 3 dependencies"
```

### Task 1.2: Настроить build.gradle.kts Android

**Файлы:**

- Modify: `apps/mobile-child/android/app/build.gradle.kts`
- Modify: `apps/mobile-child/android/build.gradle.kts`

- [ ] **Шаг 1:** Открыть `android/app/build.gradle.kts`, убедиться:

```kotlin
android {
    namespace = "ru.link28rus.gmd.child"
    compileSdk = 34

    defaultConfig {
        applicationId = "ru.link28rus.gmd.child"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.13.0"
    }
    ...
}

dependencies {
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // firebase-messaging добавим в M4
}
```

- [ ] **Шаг 2:** В `android/build.gradle.kts` убедиться, что Kotlin version `1.9.22+` и Android Gradle Plugin `8.3+`.
- [ ] **Шаг 3:** Запустить `flutter build apk --debug` — должен собраться скелет, без багов по AGP/Kotlin.
- [ ] **Шаг 4:** Если сборка успешна — commit:

```bash
git add apps/mobile-child/android/
git commit -m "feat(mobile-child): Android minSdk 26, targetSdk 34, location SDK"
```

### Task 1.3: Base app + router skeleton

**Файлы:**

- Create: `apps/mobile-child/lib/app.dart`
- Create: `apps/mobile-child/lib/router/app_router.dart`
- Modify: `apps/mobile-child/lib/main.dart`

- [ ] **Шаг 1:** Создать `lib/router/app_router.dart`:

```dart
import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';

class AppRouter {
  static final GoRouter router = GoRouter(
    initialLocation: '/onboarding',
    routes: [
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const Scaffold(body: Center(child: Text('Onboarding placeholder'))),
      ),
      GoRoute(
        path: '/claim',
        builder: (_, __) => const Scaffold(body: Center(child: Text('Claim placeholder'))),
      ),
      GoRoute(
        path: '/home',
        builder: (_, __) => const Scaffold(body: Center(child: Text('Home placeholder'))),
      ),
    ],
  );
}
```

- [ ] **Шаг 2:** Создать `lib/app.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'router/app_router.dart';

class GmdChildApp extends ConsumerWidget {
  const GmdChildApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'GMD',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF2E7D32)),
      routerConfig: AppRouter.router,
      debugShowCheckedModeBanner: false,
    );
  }
}
```

- [ ] **Шаг 3:** Заменить `lib/main.dart` на:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';

void main() {
  runApp(const ProviderScope(child: GmdChildApp()));
}
```

- [ ] **Шаг 4:** Запустить `flutter run -d <device>` (или `flutter analyze` если нет device). Должен появиться экран «Onboarding placeholder».
- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/lib/
git commit -m "feat(mobile-child): scaffold app shell + GoRouter"
```

### Task 1.4: CI workflow для mobile-child

**Файлы:**

- Create: `.github/workflows/mobile-child.yml` (если GitHub) ИЛИ `.gitea/workflows/mobile-child.yml`

- [ ] **Шаг 1:** Создать workflow:

```yaml
name: mobile-child CI
on:
  pull_request:
    paths:
      - 'apps/mobile-child/**'
      - 'packages/shared-dart/**'
  push:
    branches: [main]
    paths:
      - 'apps/mobile-child/**'

jobs:
  analyze-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.24.0'
          channel: 'stable'
      - run: dart pub global activate melos
      - run: melos bootstrap
        working-directory: .
      - run: flutter pub get
        working-directory: apps/mobile-child
      - run: flutter analyze
        working-directory: apps/mobile-child
      - run: flutter test
        working-directory: apps/mobile-child
      - run: flutter build apk --debug
        working-directory: apps/mobile-child
```

- [ ] **Шаг 2:** Запушить на feature-ветку, проверить что workflow зелёный. Если используется Gitea — путь другой, но содержание то же.
- [ ] **Шаг 3:** Commit:

```bash
git add .github/workflows/mobile-child.yml
git commit -m "ci(mobile-child): flutter analyze + test + apk debug"
```

---

## M2 — Claim flow

### Task 2.1: Secure storage wrapper + test

**Файлы:**

- Create: `apps/mobile-child/lib/core/storage/secure_storage_service.dart`
- Create: `apps/mobile-child/test/unit/secure_storage_service_test.dart`

- [ ] **Шаг 1:** Создать test, используя mocktail для FlutterSecureStorage:

```dart
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

  test('saveDeviceToken persists value', () async {
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

  test('clearAll deletes all GMD keys', () async {
    when(() => storage.deleteAll()).thenAnswer((_) async {});
    await svc.clearAll();
    verify(() => storage.deleteAll()).called(1);
  });
}
```

- [ ] **Шаг 2:** Запустить тест — должен провалиться (файл не существует). `flutter test test/unit/secure_storage_service_test.dart`.
- [ ] **Шаг 3:** Создать `lib/core/storage/secure_storage_service.dart`:

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  SecureStorageService([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;
  static const _deviceTokenKey = 'device_token';

  Future<void> saveDeviceToken(String token) =>
      _storage.write(key: _deviceTokenKey, value: token);

  Future<String?> readDeviceToken() => _storage.read(key: _deviceTokenKey);

  Future<void> clearAll() => _storage.deleteAll();
}
```

- [ ] **Шаг 4:** Запустить тест — должен пройти.
- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/lib/core/storage/ apps/mobile-child/test/unit/secure_storage_service_test.dart
git commit -m "feat(mobile-child): SecureStorageService with tests"
```

### Task 2.2: Dio client + child-api wrapper + test

**Файлы:**

- Create: `apps/mobile-child/lib/core/api/api_exceptions.dart`
- Create: `apps/mobile-child/lib/core/api/dio_client.dart`
- Create: `apps/mobile-child/lib/core/api/child_api.dart`
- Create: `apps/mobile-child/test/unit/child_api_test.dart`

- [ ] **Шаг 1:** Написать тест `test/unit/child_api_test.dart` с DioAdapter mock:

```dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/core/api/api_exceptions.dart';

class _MockDio extends Mock implements Dio {}

void main() {
  late _MockDio dio;
  late ChildApi api;

  setUpAll(() => registerFallbackValue(Options()));

  setUp(() {
    dio = _MockDio();
    api = ChildApi(dio);
  });

  test('claim returns response on 200', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/child/claim'),
        statusCode: 200,
        data: {
          'deviceToken': 'tok_123',
          'child': {'id': 'c1', 'name': 'Олег', 'familyId': 'f1'},
          'device': {'id': 'd1'},
        },
      ),
    );
    final r = await api.claim(code: '123456', deviceName: 'Pixel', osVersion: '14', appVersion: '0.13.0');
    expect(r.deviceToken, 'tok_123');
    expect(r.childId, 'c1');
  });

  test('claim throws InvalidCodeException on 404', () async {
    when(() => dio.post('/child/claim', data: any(named: 'data'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/claim'),
        response: Response(
          requestOptions: RequestOptions(path: '/child/claim'),
          statusCode: 404,
          data: {'code': 'invite_not_found'},
        ),
      ),
    );
    expect(
      () => api.claim(code: '000000', deviceName: 'x', osVersion: '14', appVersion: '0.13.0'),
      throwsA(isA<InvalidCodeException>()),
    );
  });
}
```

- [ ] **Шаг 2:** Запустить — провалится, классы не созданы.
- [ ] **Шаг 3:** Создать `api_exceptions.dart`:

```dart
sealed class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
}

class InvalidCodeException extends ApiException {
  const InvalidCodeException() : super('Код не найден или истёк');
}

class NetworkException extends ApiException {
  const NetworkException(String msg) : super(msg);
}

class ServerException extends ApiException {
  const ServerException(super.message, this.statusCode);
  final int statusCode;
}
```

- [ ] **Шаг 4:** Создать `child_api.dart`:

```dart
import 'package:dio/dio.dart';
import 'api_exceptions.dart';

class ClaimResponse {
  ClaimResponse({required this.deviceToken, required this.childId, required this.childName, required this.familyId, required this.deviceId});
  factory ClaimResponse.fromJson(Map<String, dynamic> json) => ClaimResponse(
        deviceToken: json['deviceToken'] as String,
        childId: (json['child'] as Map)['id'] as String,
        childName: (json['child'] as Map)['name'] as String,
        familyId: (json['child'] as Map)['familyId'] as String,
        deviceId: (json['device'] as Map)['id'] as String,
      );
  final String deviceToken;
  final String childId;
  final String childName;
  final String familyId;
  final String deviceId;
}

class ChildApi {
  ChildApi(this._dio);
  final Dio _dio;

  Future<ClaimResponse> claim({
    required String code,
    required String deviceName,
    required String osVersion,
    required String appVersion,
    bool consent14Plus = false,
  }) async {
    try {
      final resp = await _dio.post('/child/claim', data: {
        'code': code,
        'deviceName': deviceName,
        'osVersion': osVersion,
        'appVersion': appVersion,
        'consent14Plus': consent14Plus,
      });
      return ClaimResponse.fromJson(resp.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 404 || status == 410) throw const InvalidCodeException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }
}
```

- [ ] **Шаг 5:** Создать `dio_client.dart`:

```dart
import 'package:dio/dio.dart';

Dio buildDio({required String baseUrl, String? deviceToken}) {
  final dio = Dio(BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    sendTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'Content-Type': 'application/json'},
  ));
  if (deviceToken != null) {
    dio.options.headers['Authorization'] = 'Bearer $deviceToken';
  }
  return dio;
}
```

- [ ] **Шаг 6:** Запустить тесты — должны пройти.
- [ ] **Шаг 7:** Commit:

```bash
git add apps/mobile-child/lib/core/api/ apps/mobile-child/test/unit/child_api_test.dart
git commit -m "feat(mobile-child): ChildApi.claim + Dio client"
```

### Task 2.3: Onboarding screen

**Файлы:**

- Create: `apps/mobile-child/lib/features/onboarding/onboarding_screen.dart`
- Modify: `apps/mobile-child/lib/router/app_router.dart`
- Create: `apps/mobile-child/test/widget/onboarding_screen_test.dart`

- [ ] **Шаг 1:** Написать widget-тест:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/features/onboarding/onboarding_screen.dart';

void main() {
  testWidgets('OnboardingScreen shows welcome + connect button', (tester) async {
    await tester.pumpWidget(MaterialApp(home: OnboardingScreen(onConnect: () {})));
    expect(find.text('Привет! Это GMD'), findsOneWidget);
    expect(find.textContaining('Нужно подключиться к семье'), findsOneWidget);
    expect(find.text('Подключиться'), findsOneWidget);
  });

  testWidgets('Connect button calls onConnect', (tester) async {
    var called = false;
    await tester.pumpWidget(MaterialApp(home: OnboardingScreen(onConnect: () => called = true)));
    await tester.tap(find.text('Подключиться'));
    await tester.pumpAndSettle();
    expect(called, isTrue);
  });
}
```

- [ ] **Шаг 2:** Тест провалится — создать `onboarding_screen.dart`:

```dart
import 'package:flutter/material.dart';

class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key, required this.onConnect});
  final VoidCallback onConnect;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.shield_outlined, size: 96, color: Colors.green),
              const SizedBox(height: 24),
              Text('Привет! Это GMD',
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center),
              const SizedBox(height: 12),
              const Text('Нужно подключиться к семье',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18)),
              const Spacer(),
              FilledButton(
                onPressed: onConnect,
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 14),
                  child: Text('Подключиться', style: TextStyle(fontSize: 18)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Шаг 3:** Обновить `app_router.dart` — подключить реальный экран:

```dart
GoRoute(
  path: '/onboarding',
  builder: (ctx, __) => OnboardingScreen(onConnect: () => ctx.go('/claim')),
),
```

- [ ] **Шаг 4:** Запустить `flutter test test/widget/onboarding_screen_test.dart` + `flutter run`. Проверить UX — нажатие на «Подключиться» ведёт на `/claim`.
- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/lib/features/onboarding/ apps/mobile-child/lib/router/ apps/mobile-child/test/widget/onboarding_screen_test.dart
git commit -m "feat(mobile-child): onboarding screen with connect button"
```

### Task 2.4: Claim manual (ручной ввод кода) + controller

**Файлы:**

- Create: `apps/mobile-child/lib/features/claim/claim_controller.dart`
- Create: `apps/mobile-child/lib/features/claim/claim_manual_screen.dart`
- Create: `apps/mobile-child/test/widget/claim_manual_screen_test.dart`
- Create: `apps/mobile-child/test/unit/claim_controller_test.dart`

- [ ] **Шаг 1:** Написать test для controller (логика claim):

```dart
// test/unit/claim_controller_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/core/api/api_exceptions.dart';
import 'package:gmd_child/core/storage/secure_storage_service.dart';
import 'package:gmd_child/features/claim/claim_controller.dart';

class _MockApi extends Mock implements ChildApi {}
class _MockStorage extends Mock implements SecureStorageService {}

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
    ]);
  });

  tearDown(() => container.dispose());

  test('successful claim saves device token', () async {
    when(() => api.claim(
          code: '123456',
          deviceName: any(named: 'deviceName'),
          osVersion: any(named: 'osVersion'),
          appVersion: any(named: 'appVersion'),
          consent14Plus: any(named: 'consent14Plus'),
        )).thenAnswer((_) async => ClaimResponse(
        deviceToken: 'tok_x', childId: 'c1', childName: 'Олег', familyId: 'f1', deviceId: 'd1'));
    when(() => storage.saveDeviceToken('tok_x')).thenAnswer((_) async {});

    final notifier = container.read(claimControllerProvider.notifier);
    await notifier.submitCode('123456');
    final state = container.read(claimControllerProvider);
    expect(state.status, ClaimStatus.success);
    expect(state.childName, 'Олег');
    verify(() => storage.saveDeviceToken('tok_x')).called(1);
  });

  test('invalid code sets error state', () async {
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
  });
}
```

- [ ] **Шаг 2:** Создать `claim_controller.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../core/api/child_api.dart';
import '../../core/api/api_exceptions.dart';
import '../../core/api/dio_client.dart';
import '../../core/storage/secure_storage_service.dart';

enum ClaimStatus { idle, inProgress, success, error }

class ClaimState {
  const ClaimState({required this.status, this.childName, this.errorMessage});
  final ClaimStatus status;
  final String? childName;
  final String? errorMessage;
}

final childApiProvider = Provider<ChildApi>((_) =>
    ChildApi(buildDio(baseUrl: const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3001'))));

final secureStorageProvider = Provider<SecureStorageService>((_) => SecureStorageService());

final claimControllerProvider =
    StateNotifierProvider<ClaimController, ClaimState>((ref) => ClaimController(
          api: ref.watch(childApiProvider),
          storage: ref.watch(secureStorageProvider),
        ));

class ClaimController extends StateNotifier<ClaimState> {
  ClaimController({required ChildApi api, required SecureStorageService storage})
      : _api = api,
        _storage = storage,
        super(const ClaimState(status: ClaimStatus.idle));

  final ChildApi _api;
  final SecureStorageService _storage;

  Future<void> submitCode(String code, {bool consent14Plus = false}) async {
    state = const ClaimState(status: ClaimStatus.inProgress);
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      final pkg = await PackageInfo.fromPlatform();
      final resp = await _api.claim(
        code: code,
        deviceName: info.model,
        osVersion: 'Android ${info.version.release}',
        appVersion: pkg.version,
        consent14Plus: consent14Plus,
      );
      await _storage.saveDeviceToken(resp.deviceToken);
      state = ClaimState(status: ClaimStatus.success, childName: resp.childName);
    } on InvalidCodeException catch (e) {
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    } on NetworkException catch (e) {
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    } on ServerException catch (e) {
      state = ClaimState(status: ClaimStatus.error, errorMessage: e.message);
    }
  }

  void reset() => state = const ClaimState(status: ClaimStatus.idle);
}
```

- [ ] **Шаг 3:** Запустить unit-тест controller. Должен пройти.
- [ ] **Шаг 4:** Создать `claim_manual_screen.dart` — OTP-текстовое поле на 6 ячеек:

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'claim_controller.dart';

class ClaimManualScreen extends ConsumerStatefulWidget {
  const ClaimManualScreen({super.key});

  @override
  ConsumerState<ClaimManualScreen> createState() => _ClaimManualScreenState();
}

class _ClaimManualScreenState extends ConsumerState<ClaimManualScreen> {
  final _controller = TextEditingController();

  @override
  Widget build(BuildContext context) {
    ref.listen<ClaimState>(claimControllerProvider, (prev, next) {
      if (next.status == ClaimStatus.success) {
        context.go('/permissions/notifications');
      }
    });
    final state = ref.watch(claimControllerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Введите код')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('Код покажет мама или папа', style: TextStyle(fontSize: 18)),
            const SizedBox(height: 32),
            TextField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 32, letterSpacing: 12),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: '000000',
              ),
              onChanged: (v) {
                if (v.length == 6) {
                  ref.read(claimControllerProvider.notifier).submitCode(v);
                }
              },
            ),
            if (state.status == ClaimStatus.inProgress) ...[
              const SizedBox(height: 16),
              const CircularProgressIndicator(),
            ],
            if (state.status == ClaimStatus.error) ...[
              const SizedBox(height: 16),
              Text(state.errorMessage ?? 'Ошибка', style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Шаг 5:** Подключить route в `app_router.dart`:

```dart
GoRoute(path: '/claim/manual', builder: (_, __) => const ClaimManualScreen()),
```

- [ ] **Шаг 6:** Запустить, ввести тестовый code (нужен запущенный backend — `pnpm --filter @gmd/backend dev`, и в БД invite c кодом). Проверить переход в `/permissions/notifications` (нужно будет добавить placeholder route).
- [ ] **Шаг 7:** Commit:

```bash
git add apps/mobile-child/lib/features/claim/ apps/mobile-child/lib/router/ apps/mobile-child/test/
git commit -m "feat(mobile-child): claim manual (OTP input) + controller + tests"
```

### Task 2.5: Claim QR-screen

**Файлы:**

- Create: `apps/mobile-child/lib/features/claim/claim_screen.dart`
- Modify: `apps/mobile-child/lib/router/app_router.dart`
- Modify: `apps/mobile-child/android/app/src/main/AndroidManifest.xml` (permission CAMERA)

- [ ] **Шаг 1:** В `AndroidManifest.xml` внутри `<manifest>` добавить:

```xml
<uses-permission android:name="android.permission.CAMERA"/>
<uses-feature android:name="android.hardware.camera" android:required="false"/>
```

- [ ] **Шаг 2:** Создать `claim_screen.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'claim_controller.dart';

class ClaimScreen extends ConsumerStatefulWidget {
  const ClaimScreen({super.key});

  @override
  ConsumerState<ClaimScreen> createState() => _ClaimScreenState();
}

class _ClaimScreenState extends ConsumerState<ClaimScreen> {
  bool _handled = false;

  @override
  Widget build(BuildContext context) {
    ref.listen<ClaimState>(claimControllerProvider, (prev, next) {
      if (next.status == ClaimStatus.success) {
        context.go('/permissions/notifications');
      } else if (next.status == ClaimStatus.error) {
        setState(() => _handled = false);
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Покажи код от родителя')),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: (capture) {
              if (_handled) return;
              for (final b in capture.barcodes) {
                final v = b.rawValue;
                if (v != null && RegExp(r'^\d{6}$').hasMatch(v)) {
                  _handled = true;
                  ref.read(claimControllerProvider.notifier).submitCode(v);
                  break;
                }
              }
            },
          ),
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Center(
              child: ElevatedButton(
                onPressed: () => context.go('/claim/manual'),
                child: const Text('Ввести код вручную'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Шаг 3:** Обновить route в `app_router.dart`:

```dart
GoRoute(path: '/claim', builder: (_, __) => const ClaimScreen()),
```

- [ ] **Шаг 4:** Manual test — запустить на устройстве, показать QR с 6-значным кодом. Убедиться, что recognize-detect срабатывает и переходит в `/permissions/notifications`.
- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/lib/features/claim/claim_screen.dart apps/mobile-child/lib/router/ apps/mobile-child/android/app/src/main/AndroidManifest.xml
git commit -m "feat(mobile-child): QR-scan claim via mobile_scanner"
```

---

## M3 — Native foreground service + offline queue

### Task 3.1: Drift schema + migrations

**Файлы:**

- Create: `apps/mobile-child/lib/data/database.dart`
- Create: `apps/mobile-child/lib/data/database_connection.dart`
- Create: `apps/mobile-child/test/unit/database_test.dart`

- [ ] **Шаг 1:** Создать `database.dart` (см. §4 спеки):

```dart
import 'package:drift/drift.dart';
import 'database_connection.dart';

part 'database.g.dart';

class PendingLocations extends Table {
  IntColumn get id => integer().autoIncrement()();
  RealColumn get lat => real()();
  RealColumn get lon => real()();
  RealColumn get accuracy => real().nullable()();
  RealColumn get altitude => real().nullable()();
  RealColumn get speed => real().nullable()();
  RealColumn get bearing => real().nullable()();
  IntColumn get batteryLevel => integer().nullable()();
  BoolColumn get isCharging => boolean().nullable()();
  TextColumn get provider => text().nullable()();
  DateTimeColumn get recordedAt => dateTime()();
  IntColumn get uploadAttempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get lastAttemptAt => dateTime().nullable()();
}

class AppSettings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();
  @override
  Set<Column> get primaryKey => {key};
}

class AuditLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get event => text()();
  TextColumn get details => text().nullable()();
  DateTimeColumn get at => dateTime()();
}

@DriftDatabase(tables: [PendingLocations, AppSettings, AuditLogs])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(openConnection());
  AppDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 1;
}
```

- [ ] **Шаг 2:** Создать `database_connection.dart`:

```dart
import 'dart:io';
import 'package:drift/native.dart';
import 'package:drift/drift.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

LazyDatabase openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'gmd_child.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
```

- [ ] **Шаг 3:** Запустить codegen:

```bash
cd apps/mobile-child && dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Шаг 4:** Написать unit-тест с in-memory DB:

```dart
// test/unit/database_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/data/database.dart';

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('insert + select pending location', () async {
    await db.into(db.pendingLocations).insert(PendingLocationsCompanion.insert(
      lat: 55.7558, lon: 37.6173, recordedAt: DateTime.now(),
    ));
    final rows = await db.select(db.pendingLocations).get();
    expect(rows.length, 1);
    expect(rows.first.lat, closeTo(55.7558, 0.0001));
  });

  test('app settings upsert', () async {
    await db.into(db.appSettings).insertOnConflictUpdate(
      AppSettingsCompanion.insert(key: 'childId', value: 'c1'),
    );
    await db.into(db.appSettings).insertOnConflictUpdate(
      AppSettingsCompanion.insert(key: 'childId', value: 'c2'),
    );
    final row = await (db.select(db.appSettings)..where((t) => t.key.equals('childId'))).getSingle();
    expect(row.value, 'c2');
  });
}
```

- [ ] **Шаг 5:** Запустить тесты. Commit:

```bash
git add apps/mobile-child/lib/data/ apps/mobile-child/test/unit/database_test.dart
git commit -m "feat(mobile-child): Drift schema (pending_locations, app_settings, audit_logs)"
```

### Task 3.2: LocationQueueRepository + retry policy + test

**Файлы:**

- Create: `apps/mobile-child/lib/data/location_queue_repository.dart`
- Create: `apps/mobile-child/lib/ingestor/retry_policy.dart`
- Create: `apps/mobile-child/test/unit/retry_policy_test.dart`
- Create: `apps/mobile-child/test/unit/location_queue_repository_test.dart`

- [ ] **Шаг 1:** Написать test для `RetryPolicy`:

```dart
// test/unit/retry_policy_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/ingestor/retry_policy.dart';

void main() {
  const p = RetryPolicy(maxAttempts: 5);

  test('canRetry returns true under max', () {
    expect(p.canRetry(0), isTrue);
    expect(p.canRetry(4), isTrue);
    expect(p.canRetry(5), isFalse);
  });

  test('nextDelay exponential', () {
    expect(p.nextDelay(1).inSeconds, 2);
    expect(p.nextDelay(2).inSeconds, 4);
    expect(p.nextDelay(3).inSeconds, 8);
    expect(p.nextDelay(10).inSeconds, lessThanOrEqualTo(300)); // cap 5min
  });
}
```

- [ ] **Шаг 2:** Создать `retry_policy.dart`:

```dart
class RetryPolicy {
  const RetryPolicy({this.maxAttempts = 5});
  final int maxAttempts;

  bool canRetry(int attempts) => attempts < maxAttempts;

  Duration nextDelay(int attempt) {
    final seconds = (1 << attempt).clamp(1, 300);
    return Duration(seconds: seconds);
  }
}
```

- [ ] **Шаг 3:** Написать test `location_queue_repository_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/data/database.dart';
import 'package:gmd_child/data/location_queue_repository.dart';

void main() {
  late AppDatabase db;
  late LocationQueueRepository repo;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = LocationQueueRepository(db);
  });
  tearDown(() => db.close());

  test('enqueue + takeBatch round-trip', () async {
    for (var i = 0; i < 7; i++) {
      await repo.enqueue(
        lat: 55.75 + i * 0.001, lon: 37.61, recordedAt: DateTime.now(),
      );
    }
    final batch = await repo.takeBatch(limit: 5);
    expect(batch.length, 5);
  });

  test('deleteAccepted removes specified rows', () async {
    final id1 = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    final id2 = await repo.enqueue(lat: 2, lon: 2, recordedAt: DateTime.now());
    await repo.deleteIds([id1]);
    final left = await repo.takeBatch(limit: 100);
    expect(left.length, 1);
    expect(left.first.id, id2);
  });

  test('markRetry increments attempts', () async {
    final id = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    await repo.markRetry([id]);
    await repo.markRetry([id]);
    final rows = await repo.takeBatch(limit: 1);
    expect(rows.first.uploadAttempts, 2);
  });

  test('takeBatch excludes exhausted rows', () async {
    final id = await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    for (var i = 0; i < 5; i++) await repo.markRetry([id]);
    final rows = await repo.takeBatch(limit: 10);
    expect(rows, isEmpty);
  });

  test('trimOverflow drops oldest beyond cap', () async {
    for (var i = 0; i < 12; i++) {
      await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    }
    await repo.trimOverflow(maxSize: 10);
    final all = await repo.takeBatch(limit: 100);
    expect(all.length, 10);
  });
}
```

- [ ] **Шаг 4:** Создать `location_queue_repository.dart`:

```dart
import 'package:drift/drift.dart';
import 'database.dart';

class LocationQueueRepository {
  LocationQueueRepository(this._db);
  final AppDatabase _db;

  Future<int> enqueue({
    required double lat,
    required double lon,
    double? accuracy,
    double? altitude,
    double? speed,
    double? bearing,
    int? batteryLevel,
    bool? isCharging,
    String? provider,
    required DateTime recordedAt,
  }) async {
    return _db.into(_db.pendingLocations).insert(PendingLocationsCompanion.insert(
      lat: lat,
      lon: lon,
      accuracy: Value(accuracy),
      altitude: Value(altitude),
      speed: Value(speed),
      bearing: Value(bearing),
      batteryLevel: Value(batteryLevel),
      isCharging: Value(isCharging),
      provider: Value(provider),
      recordedAt: recordedAt,
    ));
  }

  Future<List<PendingLocation>> takeBatch({int limit = 100, int maxAttempts = 5}) {
    return (_db.select(_db.pendingLocations)
          ..where((t) => t.uploadAttempts.isSmallerThanValue(maxAttempts))
          ..orderBy([(t) => OrderingTerm.asc(t.recordedAt)])
          ..limit(limit))
        .get();
  }

  Future<void> deleteIds(List<int> ids) async {
    if (ids.isEmpty) return;
    await (_db.delete(_db.pendingLocations)..where((t) => t.id.isIn(ids))).go();
  }

  Future<void> markRetry(List<int> ids) async {
    if (ids.isEmpty) return;
    await (_db.update(_db.pendingLocations)..where((t) => t.id.isIn(ids))).write(
      PendingLocationsCompanion(
        uploadAttempts: const CustomExpression('upload_attempts + 1'),
        lastAttemptAt: Value(DateTime.now()),
      ),
    );
  }

  Future<int> count() async {
    final c = _db.pendingLocations.id.count();
    final row = await (_db.selectOnly(_db.pendingLocations)..addColumns([c])).getSingle();
    return row.read(c) ?? 0;
  }

  Future<void> trimOverflow({int maxSize = 10000}) async {
    final total = await count();
    if (total <= maxSize) return;
    final toDrop = total - maxSize;
    final oldest = await (_db.select(_db.pendingLocations)
          ..orderBy([(t) => OrderingTerm.asc(t.recordedAt)])
          ..limit(toDrop))
        .map((r) => r.id)
        .get();
    await deleteIds(oldest);
  }
}
```

- [ ] **Шаг 5:** Запустить все тесты. Исправить если надо (особенно `CustomExpression` синтаксис — может потребоваться `upload_attempts + 1` в литерале с корректным escaping).
- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/lib/data/location_queue_repository.dart apps/mobile-child/lib/ingestor/retry_policy.dart apps/mobile-child/test/unit/
git commit -m "feat(mobile-child): LocationQueueRepository + RetryPolicy (TDD)"
```

### Task 3.3: AndroidManifest — permissions + foreground service declaration

**Файлы:**

- Modify: `apps/mobile-child/android/app/src/main/AndroidManifest.xml`

- [ ] **Шаг 1:** Открыть манифест, внутри `<manifest>` над `<application>` добавить:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>
<uses-permission android:name="android.permission.VIBRATE"/>
```

- [ ] **Шаг 2:** Внутри `<application>` добавить декларацию сервиса:

```xml
<service
    android:name=".LocationForegroundService"
    android:enabled="true"
    android:exported="false"
    android:foregroundServiceType="location"/>
```

- [ ] **Шаг 3:** Commit:

```bash
git add apps/mobile-child/android/app/src/main/AndroidManifest.xml
git commit -m "feat(mobile-child): manifest permissions + foreground service declaration"
```

### Task 3.4: LocationForegroundService Kotlin

**Файлы:**

- Create: `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/LocationForegroundService.kt`
- Create: `apps/mobile-child/android/app/src/main/res/drawable/ic_notification.xml`

- [ ] **Шаг 1:** Создать простой `ic_notification.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFF"
        android:pathData="M12,2L4,12 12,22 20,12z"/>
</vector>
```

- [ ] **Шаг 2:** Создать `LocationForegroundService.kt`:

```kotlin
package ru.link28rus.gmd.child

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.plugin.common.MethodChannel

class LocationForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "gmd_location_channel"
        const val NOTIF_ID = 0xC1
        const val METHOD_CHANNEL = "ru.link28rus.gmd.child/location"
        const val ENGINE_ID = "gmd_main_engine"
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
    }

    private lateinit var fused: FusedLocationProviderClient
    private lateinit var callback: LocationCallback

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY }
            else -> start()
        }
        return START_STICKY
    }

    private fun start() {
        startForeground(NOTIF_ID, buildNotification())
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 30_000L)
            .setMinUpdateDistanceMeters(20f)
            .setMinUpdateIntervalMillis(15_000L)
            .build()
        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (loc in result.locations) {
                    sendToDart(loc)
                }
            }
        }
        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            stopSelf()
        }
    }

    private fun sendToDart(loc: android.location.Location) {
        val engine = FlutterEngineCache.getInstance().get(ENGINE_ID) ?: return
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryLevel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it > 0 }
        val isCharging = bm.isCharging
        val payload = mapOf(
            "lat" to loc.latitude,
            "lon" to loc.longitude,
            "accuracy" to loc.accuracy.toDouble(),
            "altitude" to if (loc.hasAltitude()) loc.altitude else null,
            "speed" to if (loc.hasSpeed()) loc.speed.toDouble() else null,
            "bearing" to if (loc.hasBearing()) loc.bearing.toDouble() else null,
            "batteryLevel" to batteryLevel,
            "isCharging" to isCharging,
            "provider" to (loc.provider ?: "fused"),
            "recordedAt" to loc.time,
        )
        MethodChannel(engine.dartExecutor.binaryMessenger, METHOD_CHANNEL).invokeMethod("onLocation", payload)
    }

    private fun buildNotification(): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GMD — подключено к семье")
            .setContentText("Маме/папе видно твоё местоположение")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "GMD location", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    override fun onDestroy() {
        if (::callback.isInitialized) fused.removeLocationUpdates(callback)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
```

- [ ] **Шаг 3:** В `MainActivity.kt` добавить регистрацию FlutterEngine в кеш для использования background-side:

```kotlin
package ru.link28rus.gmd.child
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        FlutterEngineCache.getInstance().put(LocationForegroundService.ENGINE_ID, flutterEngine)
    }
}
```

- [ ] **Шаг 4:** Собрать `flutter build apk --debug` — проверить что не падает.
- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/android/app/src/main/kotlin/ apps/mobile-child/android/app/src/main/res/drawable/
git commit -m "feat(mobile-child): Kotlin LocationForegroundService (Fused Provider)"
```

### Task 3.5: MethodChannel bridge в Dart + LocationIngestor

**Файлы:**

- Create: `apps/mobile-child/lib/core/native/location_service_channel.dart`
- Create: `apps/mobile-child/lib/ingestor/location_ingestor.dart`
- Create: `apps/mobile-child/test/unit/location_ingestor_test.dart`

- [ ] **Шаг 1:** Создать `location_service_channel.dart`:

```dart
import 'package:flutter/services.dart';

class LocationServiceChannel {
  static const MethodChannel _channel = MethodChannel('ru.link28rus.gmd.child/location');

  void onLocation(void Function(Map<String, dynamic>) handler) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onLocation' && call.arguments is Map) {
        handler(Map<String, dynamic>.from(call.arguments as Map));
      }
    });
  }

  Future<void> startService() async {
    await _channel.invokeMethod('startService');
  }

  Future<void> stopService() async {
    await _channel.invokeMethod('stopService');
  }
}
```

Для `startService`/`stopService` нужно также обработать на Kotlin стороне. Обновить `MainActivity.kt`:

```kotlin
import android.content.Intent
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        FlutterEngineCache.getInstance().put(LocationForegroundService.ENGINE_ID, flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LocationForegroundService.METHOD_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startService" -> {
                        val intent = Intent(this, LocationForegroundService::class.java)
                            .setAction(LocationForegroundService.ACTION_START)
                        if (android.os.Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
                        result.success(null)
                    }
                    "stopService" -> {
                        stopService(Intent(this, LocationForegroundService::class.java))
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
```

- [ ] **Шаг 2:** Написать тест `location_ingestor_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:gmd_child/data/database.dart';
import 'package:gmd_child/data/location_queue_repository.dart';
import 'package:gmd_child/ingestor/location_ingestor.dart';
import 'package:gmd_child/core/api/child_api.dart';

class _MockApi extends Mock implements ChildApi {}

void main() {
  late AppDatabase db;
  late LocationQueueRepository repo;
  late _MockApi api;
  late LocationIngestor ingestor;

  setUpAll(() {
    registerFallbackValue(<LocationPoint>[]);
  });

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = LocationQueueRepository(db);
    api = _MockApi();
    ingestor = LocationIngestor(repo: repo, api: api, deviceToken: () async => 'tok');
  });
  tearDown(() => db.close());

  test('onLocation enqueues to repo', () async {
    await ingestor.onLocation({
      'lat': 55.7558, 'lon': 37.6173,
      'accuracy': 10.0, 'batteryLevel': 80, 'isCharging': false,
      'provider': 'fused', 'recordedAt': DateTime.now().millisecondsSinceEpoch,
    });
    final left = await repo.takeBatch(limit: 10);
    expect(left.length, 1);
  });

  test('flushQueue deletes accepted ids on success', () async {
    await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    await repo.enqueue(lat: 2, lon: 2, recordedAt: DateTime.now());
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenAnswer(
      (_) async => IngestResponse(acceptedIds: [], rejectedIds: []),
    );
    // NOTE: без возвратных id backend ingest НЕ может delete — uses fact that 2xx => всё принято
    await ingestor.flushQueue();
    verify(() => api.ingestLocations(any(), deviceToken: 'tok')).called(1);
    final left = await repo.takeBatch(limit: 10);
    expect(left, isEmpty);
  });

  test('flushQueue marks retry on 5xx', () async {
    await repo.enqueue(lat: 1, lon: 1, recordedAt: DateTime.now());
    when(() => api.ingestLocations(any(), deviceToken: 'tok')).thenThrow(Exception('5xx'));
    await ingestor.flushQueue();
    final rows = await repo.takeBatch(limit: 10);
    expect(rows.first.uploadAttempts, 1);
  });
}
```

- [ ] **Шаг 3:** Расширить `ChildApi` с методом `ingestLocations`:

```dart
// в child_api.dart добавить

class LocationPoint {
  LocationPoint({required this.lat, required this.lon, required this.recordedAt, this.accuracy, this.altitude, this.speed, this.bearing, this.batteryLevel, this.isCharging, this.provider});
  final double lat, lon;
  final double? accuracy, altitude, speed, bearing;
  final int? batteryLevel;
  final bool? isCharging;
  final String? provider;
  final DateTime recordedAt;

  Map<String, dynamic> toJson() => {
        'lat': lat, 'lon': lon,
        if (accuracy != null) 'accuracy': accuracy,
        if (altitude != null) 'altitude': altitude,
        if (speed != null) 'speed': speed,
        if (bearing != null) 'bearing': bearing,
        if (batteryLevel != null) 'batteryLevel': batteryLevel,
        if (isCharging != null) 'isCharging': isCharging,
        if (provider != null) 'provider': provider,
        'recordedAt': recordedAt.toUtc().toIso8601String(),
      };
}

class IngestResponse {
  IngestResponse({required this.acceptedIds, required this.rejectedIds});
  final List<int> acceptedIds;
  final List<int> rejectedIds;
}

// in ChildApi:
Future<IngestResponse> ingestLocations(List<LocationPoint> points, {required String deviceToken}) async {
  try {
    final resp = await _dio.post(
      '/child/locations',
      data: {'points': points.map((p) => p.toJson()).toList()},
      options: Options(headers: {'Authorization': 'Bearer $deviceToken'}),
    );
    // Backend возвращает counts/accepted/rejected — если формат другой, адаптировать.
    return IngestResponse(acceptedIds: const [], rejectedIds: const []);
  } on DioException catch (e) {
    final status = e.response?.statusCode;
    if (status != null && status >= 400 && status < 500) {
      // payload invalid — дропаем как rejected всё
      throw const BadRequestIngestException();
    }
    throw NetworkException(e.message ?? 'Network');
  }
}
```

И добавить `BadRequestIngestException` в `api_exceptions.dart`:

```dart
class BadRequestIngestException extends ApiException {
  const BadRequestIngestException() : super('Invalid batch');
}
```

- [ ] **Шаг 4:** Создать `location_ingestor.dart`:

```dart
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api/child_api.dart';
import '../core/api/api_exceptions.dart';
import '../data/location_queue_repository.dart';

class LocationIngestor {
  LocationIngestor({required this.repo, required this.api, required this.deviceToken});
  final LocationQueueRepository repo;
  final ChildApi api;
  final Future<String?> Function() deviceToken;

  DateTime _lastFlush = DateTime.fromMillisecondsSinceEpoch(0);

  Future<void> onLocation(Map<String, dynamic> payload) async {
    await repo.enqueue(
      lat: (payload['lat'] as num).toDouble(),
      lon: (payload['lon'] as num).toDouble(),
      accuracy: (payload['accuracy'] as num?)?.toDouble(),
      altitude: (payload['altitude'] as num?)?.toDouble(),
      speed: (payload['speed'] as num?)?.toDouble(),
      bearing: (payload['bearing'] as num?)?.toDouble(),
      batteryLevel: payload['batteryLevel'] as int?,
      isCharging: payload['isCharging'] as bool?,
      provider: payload['provider'] as String?,
      recordedAt: DateTime.fromMillisecondsSinceEpoch((payload['recordedAt'] as num).toInt()),
    );
    await repo.trimOverflow(maxSize: 10000);
    final count = await repo.count();
    final age = DateTime.now().difference(_lastFlush);
    if (count >= 5 || age > const Duration(minutes: 3)) {
      await flushQueue();
    }
  }

  Future<void> flushQueue() async {
    _lastFlush = DateTime.now();
    final token = await deviceToken();
    if (token == null) return;
    final batch = await repo.takeBatch(limit: 100);
    if (batch.isEmpty) return;
    try {
      await api.ingestLocations(
        batch.map((r) => LocationPoint(
          lat: r.lat, lon: r.lon,
          accuracy: r.accuracy, altitude: r.altitude, speed: r.speed, bearing: r.bearing,
          batteryLevel: r.batteryLevel, isCharging: r.isCharging, provider: r.provider,
          recordedAt: r.recordedAt,
        )).toList(),
        deviceToken: token,
      );
      await repo.deleteIds(batch.map((r) => r.id).toList());
    } on BadRequestIngestException {
      await repo.deleteIds(batch.map((r) => r.id).toList());
    } catch (_) {
      await repo.markRetry(batch.map((r) => r.id).toList());
    }
  }
}
```

- [ ] **Шаг 5:** Запустить тесты — провалится где нужно будет адаптировать. Исправить mock-ожидания к реальной сигнатуре. Добить до зелёного.
- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/lib/core/ apps/mobile-child/lib/ingestor/ apps/mobile-child/android/app/src/main/kotlin/ apps/mobile-child/test/
git commit -m "feat(mobile-child): MethodChannel bridge + LocationIngestor (TDD)"
```

### Task 3.6: Permissions wizard — 4 шага

**Файлы:**

- Create: `apps/mobile-child/lib/features/permissions/permissions_wizard.dart`
- Create: `apps/mobile-child/lib/features/permissions/notifications_step.dart`
- Create: `apps/mobile-child/lib/features/permissions/location_step.dart`
- Create: `apps/mobile-child/lib/features/permissions/battery_step.dart`
- Modify: `apps/mobile-child/lib/router/app_router.dart`

- [ ] **Шаг 1:** Создать base wizard с индикатором прогресса:

```dart
// permissions_wizard.dart
import 'package:flutter/material.dart';

class PermissionsWizardScaffold extends StatelessWidget {
  const PermissionsWizardScaffold({
    super.key, required this.stepIndex, required this.totalSteps,
    required this.title, required this.description,
    required this.onRequest, required this.onSkip,
    this.actionLabel = 'Разрешить',
  });

  final int stepIndex;
  final int totalSteps;
  final String title;
  final String description;
  final VoidCallback onRequest;
  final VoidCallback onSkip;
  final String actionLabel;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Шаг ${stepIndex + 1} из $totalSteps')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LinearProgressIndicator(value: (stepIndex + 1) / totalSteps),
            const SizedBox(height: 24),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            Text(description, style: const TextStyle(fontSize: 16)),
            const Spacer(),
            FilledButton(onPressed: onRequest, child: Padding(padding: const EdgeInsets.all(14), child: Text(actionLabel))),
            TextButton(onPressed: onSkip, child: const Text('Пропустить')),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Шаг 2:** Создать notifications step:

```dart
// notifications_step.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class NotificationsPermissionsStep extends StatelessWidget {
  const NotificationsPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.notification.request();
    if (context.mounted) context.go('/permissions/location');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 0,
      totalSteps: 4,
      title: 'Уведомления',
      description: 'Маме/папе нужно знать, если что-то случится. Мы будем показывать уведомления от GMD.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/location'),
    );
  }
}
```

- [ ] **Шаг 3:** Аналогично `location_step.dart` (запрашивает `Permission.locationAlways`) и `battery_step.dart`:

```dart
// location_step.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class LocationPermissionsStep extends StatelessWidget {
  const LocationPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    // Двухшаговый flow: сначала foreground, потом background
    final whenInUse = await Permission.locationWhenInUse.request();
    if (whenInUse.isGranted) {
      await Permission.locationAlways.request();
    }
    if (context.mounted) context.go('/permissions/battery');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 1,
      totalSteps: 4,
      title: 'Местоположение',
      description: 'Чтобы видеть где ты, даже когда приложение закрыто. Нужно «Всегда» — это защищает тебя.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/battery'),
    );
  }
}
```

```dart
// battery_step.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class BatteryPermissionsStep extends StatelessWidget {
  const BatteryPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.ignoreBatteryOptimizations.request();
    if (context.mounted) context.go('/permissions/devadmin');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 2,
      totalSteps: 4,
      title: 'Не засыпать',
      description: 'Разреши приложению работать в фоне, чтобы оно не отключалось, когда нужно больше всего.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/devadmin'),
    );
  }
}
```

- [ ] **Шаг 4:** Добавить router entries (step 4 — device admin — будет в M6, пока temporary placeholder widget):

```dart
// Временный placeholder для devadmin — реализация в Task 6.2:
class _DeviceAdminPlaceholder extends StatelessWidget {
  const _DeviceAdminPlaceholder();
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: ElevatedButton(
        onPressed: () => GoRouter.of(context).go('/home'),
        child: const Text('Продолжить (devadmin placeholder)'),
      ),
    ),
  );
}
```

Routes:

```dart
GoRoute(path: '/permissions/notifications', builder: (_, __) => const NotificationsPermissionsStep()),
GoRoute(path: '/permissions/location', builder: (_, __) => const LocationPermissionsStep()),
GoRoute(path: '/permissions/battery', builder: (_, __) => const BatteryPermissionsStep()),
GoRoute(path: '/permissions/devadmin', builder: (_, __) => const _DeviceAdminPlaceholder()),
```

- [ ] **Шаг 5:** Manual test — пройти весь flow от `/claim/manual` до `/home`.
- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/lib/features/permissions/ apps/mobile-child/lib/router/
git commit -m "feat(mobile-child): permissions wizard (notifications, location, battery)"
```

### Task 3.7: Home screen + старт foreground service

**Файлы:**

- Create: `apps/mobile-child/lib/features/home/home_screen.dart`
- Create: `apps/mobile-child/lib/features/home/home_controller.dart`
- Modify: `apps/mobile-child/lib/router/app_router.dart`
- Create: `apps/mobile-child/test/widget/home_screen_test.dart`

- [ ] **Шаг 1:** Создать `home_controller.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/native/location_service_channel.dart';
import '../../core/storage/secure_storage_service.dart';
import '../../ingestor/location_ingestor.dart';
import '../../data/database.dart';
import '../../data/location_queue_repository.dart';
import '../../features/claim/claim_controller.dart';

final appDatabaseProvider = Provider<AppDatabase>((_) => AppDatabase());
final locationRepoProvider = Provider<LocationQueueRepository>((ref) => LocationQueueRepository(ref.watch(appDatabaseProvider)));
final ingestorProvider = Provider<LocationIngestor>((ref) {
  return LocationIngestor(
    repo: ref.watch(locationRepoProvider),
    api: ref.watch(childApiProvider),
    deviceToken: () => ref.watch(secureStorageProvider).readDeviceToken(),
  );
});

final serviceChannelProvider = Provider<LocationServiceChannel>((_) => LocationServiceChannel());

final homeInitProvider = FutureProvider<void>((ref) async {
  final ingestor = ref.watch(ingestorProvider);
  final ch = ref.watch(serviceChannelProvider);
  ch.onLocation(ingestor.onLocation);
  await ch.startService();
});
```

- [ ] **Шаг 2:** Создать `home_screen.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'home_controller.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(homeInitProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('GMD')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('Привет!', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Ты подключён к семье'),
            const SizedBox(height: 24),
            Row(children: const [Icon(Icons.check_circle, color: Colors.green), SizedBox(width: 8), Text('Связь с домом есть')]),
            const Spacer(),
            SizedBox(
              width: 200, height: 200,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Colors.red, shape: const CircleBorder()),
                onPressed: () {}, // SOS подключим в M5
                child: const Text('SOS', style: TextStyle(fontSize: 32, color: Colors.white)),
              ),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Шаг 3:** Подключить route:

```dart
GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
```

- [ ] **Шаг 4:** Widget test:

```dart
// test/widget/home_screen_test.dart
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
```

- [ ] **Шаг 5:** Manual test — поставить device, пройти весь flow до home. Проверить persistent-notification «GMD — подключено к семье» в шторке.
- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/lib/features/home/ apps/mobile-child/lib/router/ apps/mobile-child/test/widget/home_screen_test.dart
git commit -m "feat(mobile-child): HomeScreen + bootstrap location service"
```

### Task 3.8: Connectivity listener для немедленного flush

**Файлы:**

- Modify: `apps/mobile-child/lib/ingestor/location_ingestor.dart`
- Modify: `apps/mobile-child/lib/features/home/home_controller.dart`

- [ ] **Шаг 1:** В `home_controller.dart` обновить `homeInitProvider`:

```dart
final homeInitProvider = FutureProvider<void>((ref) async {
  final ingestor = ref.watch(ingestorProvider);
  final ch = ref.watch(serviceChannelProvider);
  ch.onLocation(ingestor.onLocation);
  await ch.startService();

  // Слушать connectivity — при transition offline→online flush
  final conn = Connectivity();
  conn.onConnectivityChanged.listen((list) {
    if (list.any((r) => r != ConnectivityResult.none)) {
      ingestor.flushQueue();
    }
  });
});
```

(импорт `package:connectivity_plus/connectivity_plus.dart`)

- [ ] **Шаг 2:** Manual test — включить airplane mode на устройстве, подождать 2 мин, выключить — должен произойти немедленный flush (проверить в БД dev-backend).
- [ ] **Шаг 3:** Commit:

```bash
git add apps/mobile-child/lib/features/home/home_controller.dart
git commit -m "feat(mobile-child): connectivity listener triggers immediate flush"
```

---

## M4 — FCM + Ring

### Task 4.1: Firebase setup

**Файлы:**

- Create: `apps/mobile-child/android/app/google-services.json` (не в git!)
- Modify: `apps/mobile-child/android/build.gradle.kts` (root)
- Modify: `apps/mobile-child/android/app/build.gradle.kts`
- Modify: `.gitignore`

- [ ] **Шаг 1:** Зайти в Firebase Console с dedicated-аккаунтом (создать `gmd-mobile-prod` если ещё нет — см. §16 спеки open question #1). Создать Android app `ru.link28rus.gmd.child`. Скачать `google-services.json`.
- [ ] **Шаг 2:** Положить файл в `apps/mobile-child/android/app/google-services.json`. Добавить в `.gitignore`:

```
apps/mobile-child/android/app/google-services.json
```

- [ ] **Шаг 3:** В root `android/build.gradle.kts` добавить в buildscript dependencies:

```kotlin
plugins {
    id("com.google.gms.google-services") version "4.4.2" apply false
}
```

- [ ] **Шаг 4:** В `android/app/build.gradle.kts` добавить внизу:

```kotlin
apply(plugin = "com.google.gms.google-services")

dependencies {
    // ...existing
    implementation("com.google.firebase:firebase-messaging-ktx:24.0.0")
}
```

- [ ] **Шаг 5:** Собрать apk — должно пройти. В `apps/mobile-child/lib/main.dart` инициализировать:

```dart
import 'package:firebase_core/firebase_core.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(const ProviderScope(child: GmdChildApp()));
}
```

- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/android/build.gradle.kts apps/mobile-child/android/app/build.gradle.kts apps/mobile-child/lib/main.dart .gitignore
git commit -m "feat(mobile-child): Firebase setup (google-services plugin + firebase_core init)"
```

### Task 4.2: Backend endpoint POST /child/device/push-token (TDD)

**Файлы:**

- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/src/child-device/dto/push-token.dto.ts`
- Modify: `apps/backend/src/child-device/child-device.controller.ts`
- Modify: `apps/backend/src/child-device/child-device.service.ts`
- Create: `apps/backend/src/child-device/child-device.controller.push-token.spec.ts`

- [ ] **Шаг 1:** Добавить поля в Prisma:

```prisma
model ChildDevice {
  // ... existing
  fcmToken          String?
  fcmTokenUpdatedAt DateTime?
}
```

Сгенерировать миграцию:

```bash
pnpm --filter @gmd/backend prisma migrate dev --name add-fcm-token-to-child-device
```

- [ ] **Шаг 2:** Создать spec (TDD first):

```typescript
// child-device.controller.push-token.spec.ts
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { INestApplication } from '@nestjs/common';

describe('POST /child/device/push-token', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let deviceToken: string;
  let deviceId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    prisma = mod.get(PrismaService);
    await app.init();
    // setup family + child + device, получить device-token через /child/claim (helper)
    // ... (helper существует в child-device.service.spec.ts — переиспользовать)
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores fcmToken on valid call', async () => {
    const resp = await request(app.getHttpServer())
      .post('/child/device/push-token')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ platform: 'fcm', token: 'fake_fcm_token_xxx' });
    expect(resp.status).toBe(200);
    const device = await prisma.childDevice.findUnique({ where: { id: deviceId } });
    expect(device?.fcmToken).toBe('fake_fcm_token_xxx');
    expect(device?.fcmTokenUpdatedAt).toBeDefined();
  });

  it('rejects unauth', async () => {
    const resp = await request(app.getHttpServer())
      .post('/child/device/push-token')
      .send({ platform: 'fcm', token: 'x' });
    expect(resp.status).toBe(401);
  });

  it('rejects token > 4096 chars', async () => {
    const long = 'a'.repeat(5000);
    const resp = await request(app.getHttpServer())
      .post('/child/device/push-token')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ platform: 'fcm', token: long });
    expect(resp.status).toBe(400);
  });
});
```

- [ ] **Шаг 3:** Запустить spec — провалится (endpoint не существует).
- [ ] **Шаг 4:** Создать DTO:

```typescript
// dto/push-token.dto.ts
import { z } from 'zod';

export const PushTokenSchema = z.object({
  platform: z.literal('fcm'),
  token: z.string().min(1).max(4096),
});

export type PushTokenDto = z.infer<typeof PushTokenSchema>;
```

- [ ] **Шаг 5:** В `child-device.controller.ts` добавить:

```typescript
@Post('device/push-token')
@HttpCode(HttpStatus.OK)
@UseGuards(ChildAuthGuard)
async registerPushToken(
  @Req() req: ChildRequest,
  @Body(new ZodValidationPipe(PushTokenSchema)) dto: PushTokenDto,
): Promise<{ ok: boolean }> {
  await this.svc.setFcmToken(req.childDevice.deviceId, dto.token);
  return { ok: true };
}
```

В service:

```typescript
async setFcmToken(deviceId: string, token: string): Promise<void> {
  await this.prisma.childDevice.update({
    where: { id: deviceId },
    data: { fcmToken: token, fcmTokenUpdatedAt: new Date() },
  });
}
```

- [ ] **Шаг 6:** Запустить spec — зелёный. Commit:

```bash
git add apps/backend/prisma/ apps/backend/src/child-device/
git commit -m "feat(backend): POST /child/device/push-token + migration"
```

### Task 4.3: Backend FCM sender service

**Файлы:**

- Create: `apps/backend/src/fcm/fcm.module.ts`
- Create: `apps/backend/src/fcm/fcm.service.ts`
- Create: `apps/backend/src/fcm/fcm.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts`
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/.env.example` + prod `.env`

- [ ] **Шаг 1:** Установить firebase-admin:

```bash
pnpm --filter @gmd/backend add firebase-admin
```

- [ ] **Шаг 2:** Написать spec — mock-based:

```typescript
// fcm.service.spec.ts
import { Test } from '@nestjs/testing';
import { FcmService } from './fcm.service';

describe('FcmService', () => {
  let svc: FcmService;
  let mockSend: jest.Mock;

  beforeEach(async () => {
    mockSend = jest.fn();
    const mod = await Test.createTestingModule({
      providers: [FcmService],
    }).compile();
    svc = mod.get(FcmService);
    (svc as any).messaging = { send: mockSend };
  });

  it('sendDataToTokens sends to each token', async () => {
    mockSend.mockResolvedValue('msgid');
    await svc.sendDataToTokens(['t1', 't2'], { type: 'ring', duration: '60' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('continues on per-token failure', async () => {
    mockSend
      .mockImplementationOnce(() => {
        throw new Error('invalid token');
      })
      .mockResolvedValue('ok');
    const res = await svc.sendDataToTokens(['bad', 'good'], { type: 'ring' });
    expect(res.successCount).toBe(1);
    expect(res.failureCount).toBe(1);
  });
});
```

- [ ] **Шаг 3:** Создать `fcm.service.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private messaging!: admin.messaging.Messaging;

  onModuleInit(): void {
    if (admin.apps.length === 0) {
      const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
      if (!saJson) {
        this.logger.warn('FCM_SERVICE_ACCOUNT_JSON not set, FCM disabled');
        return;
      }
      const credentials = JSON.parse(Buffer.from(saJson, 'base64').toString('utf-8'));
      admin.initializeApp({ credential: admin.credential.cert(credentials) });
    }
    this.messaging = admin.messaging();
  }

  async sendDataToTokens(
    tokens: string[],
    data: Record<string, string>,
    options: { priority?: 'high' | 'normal'; ttlSeconds?: number } = {},
  ): Promise<{ successCount: number; failureCount: number }> {
    if (!this.messaging) return { successCount: 0, failureCount: tokens.length };
    let ok = 0,
      fail = 0;
    for (const token of tokens) {
      try {
        await this.messaging.send({
          token,
          data,
          android: {
            priority: options.priority ?? 'high',
            ttl: (options.ttlSeconds ?? 60) * 1000,
          },
        });
        ok++;
      } catch (e) {
        fail++;
        this.logger.warn(`FCM send failed for ${token.slice(0, 12)}...: ${(e as Error).message}`);
      }
    }
    return { successCount: ok, failureCount: fail };
  }
}
```

- [ ] **Шаг 4:** Создать `fcm.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';

@Module({ providers: [FcmService], exports: [FcmService] })
export class FcmModule {}
```

- [ ] **Шаг 5:** В `.env.example` добавить:

```
FCM_SERVICE_ACCOUNT_JSON=  # base64-encoded service account JSON
```

На prod — сохранить в `/opt/gmd/.env.prod` через `ssh gmd-prod`, base64-encoded JSON (взять из Firebase Console → Project Settings → Service accounts → Generate new private key).

- [ ] **Шаг 6:** Запустить spec. Commit:

```bash
git add apps/backend/src/fcm/ apps/backend/package.json apps/backend/.env.example
git commit -m "feat(backend): FcmService (firebase-admin) + unit tests"
```

### Task 4.4: Backend POST /children/:childId/ring (TDD)

**Файлы:**

- Modify: `apps/backend/prisma/schema.prisma` (add RingEvent)
- Modify: `apps/backend/src/family/family.controller.ts`
- Modify: `apps/backend/src/family/family.service.ts`
- Create: `apps/backend/src/family/family.controller.ring.spec.ts`

- [ ] **Шаг 1:** В схему добавить:

```prisma
model RingEvent {
  id            String   @id @default(cuid())
  childId       String
  initiatedBy   String
  duration      Int
  dispatchedAt  DateTime @default(now())
  deviceCount   Int
  fcmResponse   Json?

  child Child @relation(fields: [childId], references: [id], onDelete: Cascade)

  @@index([childId, dispatchedAt(sort: Desc)])
  @@map("ring_events")
}
```

Обновить relation в `Child`: добавить `ringEvents RingEvent[]`.

Миграция:

```bash
pnpm --filter @gmd/backend prisma migrate dev --name add-ring-events
```

- [ ] **Шаг 2:** Spec `family.controller.ring.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';

describe('POST /children/:childId/ring', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parentJwt: string;
  let otherParentJwt: string;
  let childId: string;
  const fcmSendMock = jest.fn();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FcmService)
      .useValue({ sendDataToTokens: fcmSendMock, onModuleInit: jest.fn() })
      .compile();
    app = mod.createNestApplication();
    prisma = mod.get(PrismaService);
    await app.init();

    // Helpers из общих fixtures — сделать parent + другая семья + child
    // (переиспользовать из family.service.spec.ts existing helper, если есть)
    ({ parentJwt, otherParentJwt, childId } = await seedTwoFamilies(app, prisma));
  });

  beforeEach(() => fcmSendMock.mockReset().mockResolvedValue({ successCount: 1, failureCount: 0 }));

  afterAll(async () => {
    await app.close();
  });

  it('dispatches ring to child device tokens', async () => {
    await prisma.childDevice.update({
      where: { childId },
      data: { fcmToken: 'fake_token_abc' },
    });
    const resp = await request(app.getHttpServer())
      .post(`/children/${childId}/ring`)
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ duration: 30 });
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ dispatched: true, devices: 1 });
    expect(fcmSendMock).toHaveBeenCalledWith(
      ['fake_token_abc'],
      expect.objectContaining({ type: 'ring', duration: '30' }),
      expect.objectContaining({ priority: 'high', ttlSeconds: 30 }),
    );
    const events = await prisma.ringEvent.findMany({ where: { childId } });
    expect(events).toHaveLength(1);
    expect(events[0].duration).toBe(30);
  });

  it('returns 403 when parent not in child family', async () => {
    const resp = await request(app.getHttpServer())
      .post(`/children/${childId}/ring`)
      .set('Authorization', `Bearer ${otherParentJwt}`)
      .send({ duration: 30 });
    expect(resp.status).toBe(403);
  });

  it('returns 404 when childId does not exist', async () => {
    const resp = await request(app.getHttpServer())
      .post('/children/nonexistent/ring')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({});
    expect(resp.status).toBe(404);
  });

  it('enforces rate limit (5 per 10 min per child)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/children/${childId}/ring`)
        .set('Authorization', `Bearer ${parentJwt}`)
        .send({ duration: 10 })
        .expect(200);
    }
    const sixth = await request(app.getHttpServer())
      .post(`/children/${childId}/ring`)
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ duration: 10 });
    expect(sixth.status).toBe(429);
  });

  it('rejects duration > 180', async () => {
    const resp = await request(app.getHttpServer())
      .post(`/children/${childId}/ring`)
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ duration: 300 });
    expect(resp.status).toBe(400);
  });
});
```

Функция `seedTwoFamilies` — helper, который создаёт две семьи, двух parent'ов и ребёнка в первой семье. Если такого helper'а ещё нет — вынести существующий код из `family.service.spec.ts` в `test/fixtures/seed.ts` общего пользования.

- [ ] **Шаг 3:** В `family.controller.ts`:

```typescript
@Post('children/:childId/ring')
@UseGuards(JwtAuthGuard, FamilyAccessGuard)
@Throttle({ default: { ttl: 600_000, limit: 5 } })
@HttpCode(HttpStatus.OK)
async ring(
  @Req() req: AuthedRequest,
  @Param('childId') childId: string,
  @Body(new ZodValidationPipe(RingSchema)) dto: RingDto,
): Promise<{ dispatched: boolean; devices: number }> {
  return this.svc.ring(childId, req.user.id, dto.duration);
}
```

В `family.service.ts`:

```typescript
async ring(childId: string, parentUserId: string, duration = 60): Promise<{ dispatched: boolean; devices: number }> {
  const devices = await this.prisma.childDevice.findMany({
    where: { childId, revokedAt: null, fcmToken: { not: null } },
    select: { fcmToken: true },
  });
  const tokens = devices.map((d) => d.fcmToken!).filter(Boolean);
  const result = await this.fcm.sendDataToTokens(tokens, {
    type: 'ring',
    duration: String(duration),
    initiatedAt: new Date().toISOString(),
  }, { priority: 'high', ttlSeconds: duration });
  await this.prisma.ringEvent.create({
    data: {
      childId,
      initiatedBy: parentUserId,
      duration,
      deviceCount: tokens.length,
      fcmResponse: result as unknown as Prisma.InputJsonValue,
    },
  });
  return { dispatched: true, devices: tokens.length };
}
```

Создать `RingSchema`:

```typescript
export const RingSchema = z.object({
  duration: z.number().int().min(5).max(180).optional().default(60),
});
export type RingDto = z.infer<typeof RingSchema>;
```

- [ ] **Шаг 4:** Подключить FcmModule в FamilyModule. Запустить specs — зелёные.
- [ ] **Шаг 5:** Commit:

```bash
git add apps/backend/
git commit -m "feat(backend): POST /children/:id/ring + RingEvent (TDD)"
```

### Task 4.5: Mobile-child — FCM service + push-token регистрация

**Файлы:**

- Create: `apps/mobile-child/lib/core/fcm/fcm_service.dart`
- Modify: `apps/mobile-child/lib/core/api/child_api.dart` (add registerPushToken)
- Modify: `apps/mobile-child/lib/features/home/home_controller.dart`

- [ ] **Шаг 1:** В `child_api.dart` добавить:

```dart
Future<void> registerPushToken(String fcmToken, {required String deviceToken}) async {
  try {
    await _dio.post('/child/device/push-token',
        data: {'platform': 'fcm', 'token': fcmToken},
        options: Options(headers: {'Authorization': 'Bearer $deviceToken'}));
  } on DioException catch (e) {
    throw ServerException('push-token register failed', e.response?.statusCode ?? 0);
  }
}
```

- [ ] **Шаг 2:** Создать `fcm_service.dart`:

```dart
import 'package:firebase_messaging/firebase_messaging.dart';
import '../api/child_api.dart';
import '../storage/secure_storage_service.dart';

class FcmService {
  FcmService(this._api, this._storage);
  final ChildApi _api;
  final SecureStorageService _storage;

  Future<void> init(void Function(Map<String, dynamic>) onMessage) async {
    await FirebaseMessaging.instance.requestPermission();
    await _syncToken();
    FirebaseMessaging.instance.onTokenRefresh.listen((t) => _sendToken(t));
    FirebaseMessaging.onMessage.listen((msg) {
      onMessage(Map<String, dynamic>.from(msg.data));
    });
  }

  Future<void> _syncToken() async {
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await _sendToken(token);
  }

  Future<void> _sendToken(String fcmToken) async {
    final deviceToken = await _storage.readDeviceToken();
    if (deviceToken == null) return;
    await _api.registerPushToken(fcmToken, deviceToken: deviceToken);
  }
}
```

- [ ] **Шаг 3:** В `home_controller.dart` обновить `homeInitProvider` — добавить FCM init с handler который роутит ring:

```dart
final homeInitProvider = FutureProvider<void>((ref) async {
  final ingestor = ref.watch(ingestorProvider);
  final ch = ref.watch(serviceChannelProvider);
  ch.onLocation(ingestor.onLocation);
  await ch.startService();

  Connectivity().onConnectivityChanged.listen((list) {
    if (list.any((r) => r != ConnectivityResult.none)) ingestor.flushQueue();
  });

  final fcm = FcmService(ref.watch(childApiProvider), ref.watch(secureStorageProvider));
  await fcm.init((data) {
    if (data['type'] == 'ring') {
      // trigger ring
      final duration = int.tryParse(data['duration']?.toString() ?? '60') ?? 60;
      ref.read(ringControllerProvider.notifier).start(duration);
    }
  });
});
```

(`ringControllerProvider` будет создан в следующей таске.)

- [ ] **Шаг 4:** Commit:

```bash
git add apps/mobile-child/lib/core/fcm/ apps/mobile-child/lib/core/api/ apps/mobile-child/lib/features/home/
git commit -m "feat(mobile-child): FCM init + push-token registration"
```

### Task 4.6: RingService (Kotlin) + Ring overlay UI

**Файлы:**

- Create: `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/RingService.kt`
- Create: `apps/mobile-child/android/app/src/main/res/raw/alarm_loud.mp3` (user provides a royalty-free sound)
- Create: `apps/mobile-child/lib/core/native/ring_service_channel.dart`
- Create: `apps/mobile-child/lib/features/ring/ring_screen.dart`
- Create: `apps/mobile-child/lib/features/ring/ring_controller.dart`
- Modify: `apps/mobile-child/lib/router/app_router.dart`
- Modify: `apps/mobile-child/android/app/src/main/AndroidManifest.xml`

- [ ] **Шаг 1:** Скачать royalty-free звук сирены (~5-10 сек), конвертировать в mp3, положить в `android/app/src/main/res/raw/alarm_loud.mp3`. Источник: freesound.org, CC0.
- [ ] **Шаг 2:** Создать `RingService.kt`:

```kotlin
package ru.link28rus.gmd.child

import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.IBinder
import android.os.Vibrator
import android.os.VibratorManager
import android.os.Build

class RingService : Service() {
    private var player: MediaPlayer? = null
    private var originalVolume: Int = -1

    companion object {
        const val ACTION_START = "RING_START"
        const val ACTION_STOP = "RING_STOP"
        const val EXTRA_DURATION = "duration"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stop(); return START_NOT_STICKY }
            else -> {
                val duration = intent?.getIntExtra(EXTRA_DURATION, 60) ?: 60
                startRing(duration)
            }
        }
        return START_STICKY
    }

    private fun startRing(durationSec: Int) {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        originalVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)

        player = MediaPlayer.create(this, R.raw.alarm_loud).apply {
            setAudioStreamType(AudioManager.STREAM_ALARM)
            isLooping = true
            start()
        }
        vibrate()
        // stop после durationSec
        android.os.Handler(mainLooper).postDelayed({ stop() }, durationSec * 1000L)
    }

    private fun vibrate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator.vibrate(android.os.VibrationEffect.createWaveform(longArrayOf(0, 500, 200, 500), 0))
        } else {
            @Suppress("DEPRECATION")
            val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            @Suppress("DEPRECATION") v.vibrate(longArrayOf(0, 500, 200, 500), 0)
        }
    }

    private fun stop() {
        player?.stop(); player?.release(); player = null
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (originalVolume >= 0) am.setStreamVolume(AudioManager.STREAM_ALARM, originalVolume, 0)
        (getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.cancel()
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() { stop(); super.onDestroy() }
}
```

- [ ] **Шаг 3:** В манифест добавить `<service android:name=".RingService"/>` внутри application.
- [ ] **Шаг 4:** В `MainActivity.kt` добавить обработчик MethodChannel для ring:

```kotlin
MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ru.link28rus.gmd.child/ring")
    .setMethodCallHandler { call, result ->
        when (call.method) {
            "start" -> {
                val duration = call.argument<Int>("duration") ?: 60
                val intent = Intent(this, RingService::class.java)
                    .setAction(RingService.ACTION_START)
                    .putExtra(RingService.EXTRA_DURATION, duration)
                startService(intent)
                result.success(null)
            }
            "stop" -> {
                startService(Intent(this, RingService::class.java).setAction(RingService.ACTION_STOP))
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }
```

- [ ] **Шаг 5:** Создать Dart-обёртку `ring_service_channel.dart`:

```dart
import 'package:flutter/services.dart';

class RingServiceChannel {
  static const MethodChannel _ch = MethodChannel('ru.link28rus.gmd.child/ring');
  Future<void> start(int duration) => _ch.invokeMethod('start', {'duration': duration});
  Future<void> stop() => _ch.invokeMethod('stop');
}
```

- [ ] **Шаг 6:** Создать `ring_controller.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/native/ring_service_channel.dart';

final ringServiceProvider = Provider<RingServiceChannel>((_) => RingServiceChannel());

class RingState {
  const RingState({required this.active, this.duration = 0});
  final bool active;
  final int duration;
}

final ringControllerProvider = StateNotifierProvider<RingController, RingState>((ref) =>
    RingController(ref.watch(ringServiceProvider)));

class RingController extends StateNotifier<RingState> {
  RingController(this._svc) : super(const RingState(active: false));
  final RingServiceChannel _svc;

  Future<void> start(int duration) async {
    state = RingState(active: true, duration: duration);
    await _svc.start(duration);
    // После timeout — сбросим в UI, собственно Kotlin-stop произойдёт сам.
  }

  Future<void> stop() async {
    await _svc.stop();
    state = const RingState(active: false);
  }
}
```

- [ ] **Шаг 7:** Создать `ring_screen.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'ring_controller.dart';

class RingScreen extends ConsumerWidget {
  const RingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(ringControllerProvider);
    return Scaffold(
      backgroundColor: Colors.red,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.notifications_active, size: 128, color: Colors.white),
              const SizedBox(height: 24),
              const Text('Мама/папа зовут тебя!',
                  style: TextStyle(fontSize: 28, color: Colors.white, fontWeight: FontWeight.bold)),
              const SizedBox(height: 48),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.red, minimumSize: const Size(240, 80)),
                onPressed: () async {
                  await ref.read(ringControllerProvider.notifier).stop();
                  if (context.mounted) context.go('/home');
                },
                child: const Text('Я здесь', style: TextStyle(fontSize: 24)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Шаг 8:** Добавить route `/ring` в `app_router.dart`. В FCM-handler в `home_controller.dart` после `ringControllerProvider.notifier.start()` — навигация:

```dart
if (data['type'] == 'ring') {
  ref.read(ringControllerProvider.notifier).start(duration);
  rootNavigatorKey.currentContext?.go('/ring');
}
```

(Потребуется `rootNavigatorKey` — add `navigatorKey: AppRouter.rootKey` в GoRouter init.)

- [ ] **Шаг 9:** Manual test: запустить backend + mobile-child на реальном устройстве. Из Postman/curl:

```bash
curl -X POST http://localhost:3001/children/<childId>/ring \
  -H "Authorization: Bearer <parentJWT>" \
  -H "Content-Type: application/json" \
  -d '{"duration":10}'
```

— устройство должно играть звук + показать ring screen. Протестить, что `STREAM_ALARM` работает даже в silent mode.

- [ ] **Шаг 10:** Commit:

```bash
git add apps/mobile-child/
git commit -m "feat(mobile-child): Ring service (Kotlin) + overlay UI + FCM ring routing"
```

---

## M5 — SOS

### Task 5.1: Backend SOS module (TDD)

**Файлы:**

- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/src/sos/sos.module.ts`
- Create: `apps/backend/src/sos/sos.controller.ts`
- Create: `apps/backend/src/sos/sos.service.ts`
- Create: `apps/backend/src/sos/sos.service.spec.ts`
- Create: `apps/backend/src/sos/dto/sos.dto.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Шаг 1:** Добавить Prisma-модель:

```prisma
model SosEvent {
  id              String   @id @default(cuid())
  childId         String
  childDeviceId   String
  lat             Float
  lon             Float
  accuracy        Float?
  recordedAt      DateTime
  serverCreatedAt DateTime @default(now())
  message         String?  @db.VarChar(500)
  acknowledgedAt  DateTime?
  acknowledgedBy  String?

  child       Child       @relation(fields: [childId], references: [id], onDelete: Cascade)
  childDevice ChildDevice @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)

  @@index([childId, serverCreatedAt(sort: Desc)])
  @@map("sos_events")
}
```

И relations в Child/ChildDevice.

Миграция:

```bash
pnpm --filter @gmd/backend prisma migrate dev --name add-sos-events
```

- [ ] **Шаг 2:** Написать spec (supertest + FCM mock + mailer mock):

```typescript
// sos.service.spec.ts
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { MailerService } from '../mailer/mailer.service'; // уточнить точный путь

describe('POST /sos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let deviceToken: string;
  let childId: string;
  let parentEmail: string;
  const fcmMock = jest.fn();
  const mailMock = jest.fn();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FcmService)
      .useValue({ sendDataToTokens: fcmMock, onModuleInit: jest.fn() })
      .overrideProvider(MailerService)
      .useValue({ send: mailMock })
      .compile();
    app = mod.createNestApplication();
    prisma = mod.get(PrismaService);
    await app.init();
    ({ deviceToken, childId, parentEmail } = await seedFamilyWithClaim(app, prisma));
  });

  beforeEach(() => {
    fcmMock.mockReset().mockResolvedValue({ successCount: 1, failureCount: 0 });
    mailMock.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates SosEvent + sends email', async () => {
    const resp = await request(app.getHttpServer())
      .post('/sos')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ lat: 55.7558, lon: 37.6173, accuracy: 10, recordedAt: new Date().toISOString() });
    expect(resp.status).toBe(200);
    expect(resp.body.sosId).toBeDefined();
    const events = await prisma.sosEvent.findMany({ where: { childId } });
    expect(events).toHaveLength(1);
    expect(mailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: parentEmail,
        subject: expect.stringContaining('SOS'),
      }),
    );
  });

  it('returns 401 without auth', async () => {
    const resp = await request(app.getHttpServer())
      .post('/sos')
      .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });
    expect(resp.status).toBe(401);
  });

  it('returns 400 on invalid lat', async () => {
    const resp = await request(app.getHttpServer())
      .post('/sos')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ lat: 999, lon: 37, recordedAt: new Date().toISOString() });
    expect(resp.status).toBe(400);
  });

  it('enforces rate limit (3 per 5 min per device)', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/sos')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() })
        .expect(200);
    }
    const fourth = await request(app.getHttpServer())
      .post('/sos')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });
    expect(fourth.status).toBe(429);
  });

  it('returns 200 even if mailer fails (event already saved)', async () => {
    mailMock.mockRejectedValueOnce(new Error('SMTP down'));
    const resp = await request(app.getHttpServer())
      .post('/sos')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });
    expect(resp.status).toBe(200);
    const events = await prisma.sosEvent.findMany({ where: { childId } });
    expect(events.length).toBeGreaterThan(0);
  });
});
```

Helper `seedFamilyWithClaim` — вынести в `test/fixtures/seed.ts`, создаёт family + parent user + child + childDevice с claimed device-token, возвращает `{ deviceToken, childId, parentEmail }`. Используется также в Task 4.4 и Task 4.2.

- [ ] **Шаг 3:** Реализовать `SosSchema`:

```typescript
export const SosSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  recordedAt: z.string().datetime(),
  message: z.string().max(500).optional(),
});
```

- [ ] **Шаг 4:** `sos.controller.ts`:

```typescript
@Controller('sos')
export class SosController {
  constructor(@Inject(SosService) private svc: SosService) {}

  @Post()
  @UseGuards(ChildAuthGuard)
  @Throttle({ default: { ttl: 300_000, limit: 3 } })
  @HttpCode(HttpStatus.OK)
  async create(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(SosSchema)) dto: SosDto,
  ): Promise<{ sosId: string; createdAt: string }> {
    return this.svc.create(req.childDevice, dto);
  }
}
```

`sos.service.ts`:

```typescript
@Injectable()
export class SosService {
  constructor(
    private prisma: PrismaService,
    private fcm: FcmService,
    private mailer: MailerService, // существующий
  ) {}

  async create(ctx: ChildAuthContext, dto: SosDto) {
    const event = await this.prisma.sosEvent.create({
      data: {
        childId: ctx.childId,
        childDeviceId: ctx.deviceId,
        lat: dto.lat,
        lon: dto.lon,
        accuracy: dto.accuracy,
        recordedAt: new Date(dto.recordedAt),
        message: dto.message,
      },
    });

    // parent FCM tokens — all parent user devices (mobile-parent), но для Phase 3 этого ещё нет. Шлём только email.
    // В Phase 4 — добавим mobile-parent FCM tokens.

    // email всем parent в семье
    const family = await this.prisma.family.findFirst({
      where: { children: { some: { id: ctx.childId } } },
      include: { memberships: { include: { user: true } } },
    });
    if (family) {
      const emails = family.memberships.map((m) => m.user.email).filter(Boolean);
      for (const to of emails) {
        await this.mailer.send({
          to,
          subject: '🚨 SOS от ребёнка',
          text: `Ребёнок ${ctx.childName} отправил SOS.\nКоординаты: ${dto.lat}, ${dto.lon}\nОткрыть: https://gmd.link28rus.ru/family/sos`,
        });
      }
    }

    return { sosId: event.id, createdAt: event.serverCreatedAt.toISOString() };
  }
}
```

- [ ] **Шаг 5:** Подключить SosModule в AppModule. Запустить specs — зелёные.
- [ ] **Шаг 6:** Commit:

```bash
git add apps/backend/
git commit -m "feat(backend): POST /sos endpoint + SosEvent (TDD)"
```

### Task 5.2: GET /family/sos polling endpoint

**Файлы:**

- Modify: `apps/backend/src/family/family.controller.ts`
- Modify: `apps/backend/src/family/family.service.ts`
- Create/Modify: spec

- [ ] **Шаг 1:** Spec — авторизованный parent видит свои SOS, чужие не видит, `since` query фильтрует.
- [ ] **Шаг 2:**

```typescript
@Get('family/sos')
@UseGuards(JwtAuthGuard)
async listSos(
  @Req() req: AuthedRequest,
  @Query('since') since?: string,
): Promise<{ events: SosEventDto[] }> {
  return this.svc.listFamilySos(req.user.id, since ? new Date(since) : undefined);
}
```

Service:

```typescript
async listFamilySos(userId: string, since?: Date) {
  const memberships = await this.prisma.membership.findMany({ where: { userId }, select: { familyId: true } });
  const familyIds = memberships.map((m) => m.familyId);
  const events = await this.prisma.sosEvent.findMany({
    where: { child: { familyId: { in: familyIds } }, ...(since ? { serverCreatedAt: { gte: since } } : {}) },
    orderBy: { serverCreatedAt: 'desc' },
    take: 50,
  });
  return { events: events.map((e) => ({
    id: e.id, childId: e.childId,
    lat: e.lat, lon: e.lon, accuracy: e.accuracy,
    recordedAt: e.recordedAt.toISOString(),
    serverCreatedAt: e.serverCreatedAt.toISOString(),
    message: e.message, acknowledgedAt: e.acknowledgedAt?.toISOString(),
  })) };
}
```

- [ ] **Шаг 3:** Запустить spec. Commit:

```bash
git add apps/backend/src/family/
git commit -m "feat(backend): GET /family/sos polling for web cabinet"
```

### Task 5.3: Mobile-child — SOS UI + API call

**Файлы:**

- Modify: `apps/mobile-child/lib/core/api/child_api.dart`
- Create: `apps/mobile-child/lib/features/sos/sos_controller.dart`
- Modify: `apps/mobile-child/lib/features/home/home_screen.dart`
- Create: `apps/mobile-child/test/widget/sos_button_test.dart`

- [ ] **Шаг 1:** В `child_api.dart`:

```dart
Future<SosResponse> sendSos({required double lat, required double lon, double? accuracy, String? message, required String deviceToken}) async {
  try {
    final resp = await _dio.post('/sos', data: {
      'lat': lat, 'lon': lon,
      if (accuracy != null) 'accuracy': accuracy,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
      if (message != null) 'message': message,
    }, options: Options(headers: {'Authorization': 'Bearer $deviceToken'}));
    return SosResponse(sosId: resp.data['sosId'] as String, createdAt: DateTime.parse(resp.data['createdAt'] as String));
  } on DioException catch (e) {
    final s = e.response?.statusCode;
    if (s == 429) throw const TooManyRequestsException();
    throw ServerException('SOS failed', s ?? 0);
  }
}

class SosResponse { ... /* как в задаче 2.2 */ }
```

Добавить `TooManyRequestsException` в api_exceptions.

- [ ] **Шаг 2:** Создать `sos_controller.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import '../../core/api/child_api.dart';
import '../../core/storage/secure_storage_service.dart';
import '../claim/claim_controller.dart';

enum SosStatus { idle, sending, success, error }

class SosState {
  const SosState({required this.status, this.error});
  final SosStatus status;
  final String? error;
}

final sosControllerProvider = StateNotifierProvider<SosController, SosState>((ref) =>
    SosController(ref.watch(childApiProvider), ref.watch(secureStorageProvider)));

class SosController extends StateNotifier<SosState> {
  SosController(this._api, this._storage) : super(const SosState(status: SosStatus.idle));
  final ChildApi _api;
  final SecureStorageService _storage;

  Future<void> send({String? message}) async {
    state = const SosState(status: SosStatus.sending);
    try {
      final pos = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
      final dt = await _storage.readDeviceToken();
      if (dt == null) throw Exception('Not authenticated');
      await _api.sendSos(lat: pos.latitude, lon: pos.longitude, accuracy: pos.accuracy, message: message, deviceToken: dt);
      state = const SosState(status: SosStatus.success);
    } catch (e) {
      state = SosState(status: SosStatus.error, error: e.toString());
    }
  }

  void reset() => state = const SosState(status: SosStatus.idle);
}
```

- [ ] **Шаг 3:** Обновить `home_screen.dart` — подключить long-press SOS с confirmation dialog:

```dart
// Заменить SOS-кнопку на GestureDetector с onLongPress
GestureDetector(
  onLongPress: () async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отправить SOS?'),
        content: const Text('Родителям придёт срочное уведомление'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Отмена')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Отправить')),
        ],
      ),
    );
    if (confirm == true) {
      await ref.read(sosControllerProvider.notifier).send();
    }
  },
  child: // ...SOS круглая кнопка
),
```

После успеха — `SnackBar('Помощь идёт 💚')`.

- [ ] **Шаг 4:** Widget-test: long-press → dialog → confirm → controller state == sending.
- [ ] **Шаг 5:** Commit:

```bash
git add apps/mobile-child/lib/core/api/ apps/mobile-child/lib/features/sos/ apps/mobile-child/lib/features/home/ apps/mobile-child/test/
git commit -m "feat(mobile-child): SOS long-press + confirmation + API call"
```

---

## M6 — Anti-uninstall (Device Admin)

### Task 6.1: DeviceAdminReceiver + config

**Файлы:**

- Create: `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/GmdDeviceAdminReceiver.kt`
- Create: `apps/mobile-child/android/app/src/main/res/xml/device_admin.xml`
- Modify: `apps/mobile-child/android/app/src/main/AndroidManifest.xml`

- [ ] **Шаг 1:** Создать `device_admin.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-policies>
    <force-lock/>
  </uses-policies>
</device-admin>
```

- [ ] **Шаг 2:** `GmdDeviceAdminReceiver.kt`:

```kotlin
package ru.link28rus.gmd.child

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

class GmdDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return "Если ты выключишь защиту, мама/папа не смогут тебя найти в случае опасности."
    }
}
```

- [ ] **Шаг 3:** Обновить `AndroidManifest.xml`:

```xml
<receiver
    android:name=".GmdDeviceAdminReceiver"
    android:permission="android.permission.BIND_DEVICE_ADMIN"
    android:exported="true">
  <meta-data
      android:name="android.app.device_admin"
      android:resource="@xml/device_admin"/>
  <intent-filter>
    <action android:name="android.app.action.DEVICE_ADMIN_ENABLED"/>
  </intent-filter>
</receiver>
```

- [ ] **Шаг 4:** Собрать — не должно быть ошибок. Commit:

```bash
git add apps/mobile-child/android/
git commit -m "feat(mobile-child): GmdDeviceAdminReceiver + manifest"
```

### Task 6.2: Device admin permissions wizard step

**Файлы:**

- Create: `apps/mobile-child/lib/core/native/device_admin_channel.dart`
- Create: `apps/mobile-child/lib/features/permissions/device_admin_step.dart`
- Modify: `apps/mobile-child/lib/router/app_router.dart`
- Modify: `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/MainActivity.kt`

- [ ] **Шаг 1:** В `MainActivity.kt` добавить MethodChannel для device admin:

```kotlin
MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ru.link28rus.gmd.child/device_admin")
    .setMethodCallHandler { call, result ->
        when (call.method) {
            "request" -> {
                val dpm = getSystemService(DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                val component = android.content.ComponentName(this, GmdDeviceAdminReceiver::class.java)
                if (dpm.isAdminActive(component)) {
                    result.success("already")
                } else {
                    val intent = Intent(android.app.admin.DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(android.app.admin.DevicePolicyManager.EXTRA_DEVICE_ADMIN, component)
                        .putExtra(android.app.admin.DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                            "Защита от удаления. Мама/папа получит уведомление, если ты попытаешься выключить.")
                    startActivity(intent)
                    result.success("requested")
                }
            }
            "isActive" -> {
                val dpm = getSystemService(DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                result.success(dpm.isAdminActive(android.content.ComponentName(this, GmdDeviceAdminReceiver::class.java)))
            }
            else -> result.notImplemented()
        }
    }
```

- [ ] **Шаг 2:** Создать `device_admin_channel.dart`:

```dart
import 'package:flutter/services.dart';

class DeviceAdminChannel {
  static const _ch = MethodChannel('ru.link28rus.gmd.child/device_admin');
  Future<String> request() async => await _ch.invokeMethod<String>('request') ?? 'unknown';
  Future<bool> isActive() async => await _ch.invokeMethod<bool>('isActive') ?? false;
}
```

- [ ] **Шаг 3:** Создать `device_admin_step.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/native/device_admin_channel.dart';
import 'permissions_wizard.dart';

class DeviceAdminPermissionsStep extends StatelessWidget {
  const DeviceAdminPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await DeviceAdminChannel().request();
    // Android вернётся в приложение после диалога; переход вперёд — по готовности
    if (context.mounted) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 3,
      totalSteps: 4,
      title: 'Защита от удаления',
      description: 'Попросим маму/папу подтвердить, если ты захочешь удалить приложение. Это на случай, если телефон попадёт в чужие руки.',
      actionLabel: 'Включить защиту',
      onRequest: () => _request(context),
      onSkip: () => context.go('/home'),
    );
  }
}
```

- [ ] **Шаг 4:** Обновить `/permissions/devadmin` route в `app_router.dart` на `const DeviceAdminPermissionsStep()`.
- [ ] **Шаг 5:** Manual test — пройти wizard, увидеть системный диалог Device Admin, активировать. Попробовать удалить приложение long-press → Android блокирует, предлагает сначала деактивировать device admin.
- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/lib/core/native/ apps/mobile-child/lib/features/permissions/ apps/mobile-child/lib/router/ apps/mobile-child/android/app/src/main/kotlin/
git commit -m "feat(mobile-child): Device Admin wizard step + MethodChannel"
```

### Task 6.3: Play Console permission declaration doc

**Файлы:**

- Create: `apps/mobile-child/android/PLAY_CONSOLE_PERMISSIONS.md`

- [ ] **Шаг 1:** Написать шаблон для Play Console:

```markdown
# GMD mobile-child — Play Console permission declarations

## ACCESS_BACKGROUND_LOCATION

**Core functionality:** continuously report child's location to parents even when the app is closed, for safety purposes.
**User flow:** During onboarding, child explicitly grants background location after parent creates the invite and child device is claimed. Persistent foreground notification shows location is being reported.

## BIND_DEVICE_ADMIN (Device Administrator API)

**Core functionality:** Parental control for minors — prevent accidental or unauthorized uninstall of the safety monitoring app.
**User type:** Minors with parental consent.
**User flow:** Onboarding explicitly asks child to activate Device Administrator. The explanation text states parents will be notified on deactivation attempts. Child can still disable via Settings → Security → Device admin.

## FOREGROUND_SERVICE_LOCATION

**Core functionality:** Background location for parental monitoring (same justification as ACCESS_BACKGROUND_LOCATION).

## Supporting docs

- Privacy Policy: https://gmd.link28rus.ru/privacy
- Parent consent evidence: stored in ConsentRecord table at claim time
- Demo video: [upload 2-min onboarding flow showing explicit consent UI]
```

- [ ] **Шаг 2:** Commit:

```bash
git add apps/mobile-child/android/PLAY_CONSOLE_PERMISSIONS.md
git commit -m "docs(mobile-child): Play Console permission declarations template"
```

---

## M7 — QA pass + release

### Task 7.1: Manual QA matrix

**Файлы:** none (это QA-прогон)

- [ ] **Шаг 1:** Собрать release-like debug-APK: `flutter build apk --debug`. Установить на Pixel 6/7, Samsung A-series, Xiaomi Redmi.
- [ ] **Шаг 2:** На каждом устройстве пройти полный сценарий: claim → permissions → home. Записать в таблицу результат по критериям §11 спеки.
- [ ] **Шаг 3:** На Xiaomi дополнительно — разрешить autostart в MIUI-настройках (Battery & performance → Settings → Autostart → GMD). Задокументировать в user-guide.
- [ ] **Шаг 4:** Если обнаружены баги — создать issue, пофиксить до M7.3 (release).

### Task 7.2: Battery benchmark

**Файлы:** `docs/mobile-child-battery-benchmark.md`

- [ ] **Шаг 1:** Pixel 6, battery 100%, WiFi+GPS on, claim выполнен. Запустить:

```bash
adb shell dumpsys batterystats --reset
```

- [ ] **Шаг 2:** Оставить устройство на 8 часов в background с включённым foreground service.
- [ ] **Шаг 3:** Снять показания:

```bash
adb shell dumpsys batterystats > battery-report.txt
# Смотрим "Estimated battery capacity" до/после
```

- [ ] **Шаг 4:** Записать результат в `docs/mobile-child-battery-benchmark.md`. Если drop > 15% — анализировать wakelocks:

```bash
adb shell dumpsys batterystats | grep "Wake lock" | head -20
```

Типичные оптимизации: поднять `interval` до 60 сек, уменьшить `accuracy` до `PRIORITY_BALANCED_POWER_ACCURACY` в battery-tier < 30%.

- [ ] **Шаг 5:** Commit результата (текстом):

```bash
git add docs/mobile-child-battery-benchmark.md
git commit -m "docs(mobile-child): 8h battery benchmark results (Pixel 6)"
```

### Task 7.3: Release APK signing + keystore setup

**Файлы:**

- Create: `apps/mobile-child/android/keystore.properties.example`
- Create: `apps/mobile-child/android/app/gmd-child.jks` (prod-only, не в git)
- Modify: `apps/mobile-child/android/app/build.gradle.kts`
- Modify: `.gitignore`

- [ ] **Шаг 1:** Сгенерировать keystore:

```bash
keytool -genkey -v -keystore gmd-child.jks \
  -alias gmd-child \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
# Пароли — сохранить в memory-compiler save_secret
```

- [ ] **Шаг 2:** Переложить `.jks` на prod-сервер в `/opt/gmd/keystores/mobile-child/gmd-child.jks` (через scp). В `.gitignore` добавить:

```
apps/mobile-child/android/app/gmd-child.jks
apps/mobile-child/android/keystore.properties
```

- [ ] **Шаг 3:** `keystore.properties.example`:

```
storePassword=CHANGE_ME
keyPassword=CHANGE_ME
keyAlias=gmd-child
storeFile=../app/gmd-child.jks
```

- [ ] **Шаг 4:** В `android/app/build.gradle.kts` добавить:

```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        create("release") {
            storeFile = keystoreProperties["storeFile"]?.let { file(it as String) }
            storePassword = keystoreProperties["storePassword"] as String?
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

- [ ] **Шаг 5:** На dev-машине — скопировать `keystore.properties` из `/opt/gmd/keystores/mobile-child/` (или генерить новый для dev-test). Запустить:

```bash
cd apps/mobile-child && flutter build apk --release
```

Должен создаться signed APK в `build/app/outputs/flutter-apk/app-release.apk`.

- [ ] **Шаг 6:** Commit:

```bash
git add apps/mobile-child/android/app/build.gradle.kts apps/mobile-child/android/keystore.properties.example .gitignore
git commit -m "feat(mobile-child): release APK signing config"
```

### Task 7.4: CHANGELOG + tag v0.13.0

**Файлы:**

- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `apps/mobile-child/pubspec.yaml` (version +1)

- [ ] **Шаг 1:** Добавить новую секцию в `CHANGELOG.md`:

```markdown
## v0.13.0 — 2026-05-XX

### Новые возможности

- **Приложение для ребёнка (Android)** — первый релиз mobile-child: привязка к семье по QR-коду, фоновая отправка местоположения, SOS-кнопка, защита от удаления. (#XX)
- **Громкий сигнал от родителя** — родитель может позвать ребёнка даже если телефон стоит на беззвучном режиме. Реализовано через FCM → STREAM_ALARM. (#XX)
- **SOS от ребёнка** — экстренная кнопка отправляет координаты родителям + email-оповещение. (#XX)
- **Защита от удаления** — приложение регистрируется как Device Admin; удаление блокируется стандартным Android-flow. (#XX)

### Изменения

- Backend: новые endpoints `POST /child/device/push-token`, `POST /sos`, `GET /family/sos`, `POST /children/:id/ring`.
- Backend: новые таблицы `sos_events`, `ring_events`; поле `child_devices.fcm_token`.
- Infra: Firebase FCM интеграция, service-account JSON в `.env.prod`.
- Docs: Play Console permission declarations template.
```

- [ ] **Шаг 2:** Bump versions:
  - `package.json` → `"version": "0.13.0"`
  - `apps/mobile-child/pubspec.yaml` → `version: 0.13.0+1`

- [ ] **Шаг 3:** Financial commit + tag:

```bash
git add CHANGELOG.md package.json apps/mobile-child/pubspec.yaml
git commit -m "chore(release): v0.13.0"
git tag v0.13.0
git push origin main --tags  # если remote настроен
```

- [ ] **Шаг 4:** На prod — обновить `.env.prod` c `FCM_SERVICE_ACCOUNT_JSON`. Запустить prisma migrate:

```bash
ssh gmd-prod 'cd /opt/gmd && docker exec gmd-backend pnpm prisma migrate deploy'
bash infra/deploy/deploy.sh  # существующий deploy-скрипт
```

- [ ] **Шаг 5:** Manual smoke — отправить curl-запрос на `/family/sos` (должен быть 200), `curl .../readyz` (up).

### Task 7.5: Обновить CLAUDE.md и memory-compiler

**Файлы:**

- Modify: `CLAUDE.md`

- [ ] **Шаг 1:** В CLAUDE.md раздел «Открытые вопросы» — закрыть пункт 3 (Riverpod): `~~State-management Flutter: Riverpod vs Bloc~~ → **Riverpod** (реализовано в Phase 3)`.
- [ ] **Шаг 2:** В memory-compiler `save_decision` — «Phase 3 mobile-child — архитектура», ссылка на spec + plan.
- [ ] **Шаг 3:** Commit:

```bash
git add CLAUDE.md
git commit -m "docs: close Riverpod decision after Phase 3 completion"
```

---

## Self-review checklist

После выполнения всех M1–M7 проверить:

- [ ] Все критерии §11 спеки выполнены (claim < 90s, battery ≤ 15% за 8h, offline 30 min, SOS < 5s, ring < 10s, anti-uninstall, permissions skip-friendly).
- [ ] CHANGELOG и tag v0.13.0 созданы.
- [ ] Миграции применены на prod.
- [ ] FCM_SERVICE_ACCOUNT_JSON положен в `.env.prod`.
- [ ] Release APK signed и билдится.
- [ ] `git push origin main --tags` выполнен (если remote настроен).
- [ ] `memory-compiler finish_task` вызван с summary.
