import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:periscop_child/core/api/child_api.dart';
import 'package:periscop_child/core/storage/secure_storage_service.dart';
import 'package:periscop_child/features/claim/claim_controller.dart';
import 'package:periscop_child/features/home/home_screen.dart';
import 'package:periscop_child/features/home/protection_banner.dart';
import 'package:periscop_child/features/sos/sos_controller.dart';
import 'package:permission_handler/permission_handler.dart';

class _MockDio extends Mock implements Dio {}

class _MockStorage extends Mock implements SecureStorageService {}

const _dialer = MethodChannel('pro.periscop.child/dialer');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late _MockDio dio;
  late _MockStorage storage;
  late List<String> locationCalls;

  void mockChannel(String name, Future<Object?> Function(MethodCall) handler) {
    final channel = MethodChannel(name);
    messenger.setMockMethodCallHandler(channel, handler);
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
  }

  setUpAll(() => registerFallbackValue(Options()));

  setUp(() {
    dio = _MockDio();
    storage = _MockStorage();
    locationCalls = [];
    when(() => storage.readDeviceToken()).thenAnswer((_) async => 'test-token');
    when(storage.clearAll).thenAnswer((_) async {});
    mockChannel('flutter.baseflow.com/permissions/methods', (_) async => 1);
    mockChannel('pro.periscop.child/location', (call) async {
      locationCalls.add(call.method);
      return null;
    });
    mockChannel('pro.periscop.child/app_control', (call) async {
      return call.method == 'consumePostUpdateFlag' ? null : true;
    });
    mockChannel('pro.periscop.child/protection', (_) async => true);
    when(
      () => dio.get('/child/me', options: any(named: 'options')),
    ).thenAnswer((_) async => _meResponse('Моя семья'));
  });

  Future<void> openHome(
    WidgetTester tester, {
    GoRouter? router,
    double textScale = 1,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          childApiProvider.overrideWithValue(ChildApi(dio)),
          secureStorageProvider.overrideWithValue(storage),
          protectionStateProvider.overrideWith(
            (_) async =>
                const ProtectionState(enabled: true, adminActive: true),
          ),
          positionLocatorProvider.overrideWithValue(
            () async => Position(
              latitude: 1,
              longitude: 2,
              timestamp: DateTime.utc(2026),
              accuracy: 10,
              altitude: 0,
              altitudeAccuracy: 0,
              heading: 0,
              headingAccuracy: 0,
              speed: 0,
              speedAccuracy: 0,
            ),
          ),
        ],
        child: router != null
            ? MaterialApp.router(routerConfig: router)
            : MaterialApp(
                home: Builder(
                  builder: (context) => MediaQuery(
                    data: MediaQuery.of(
                      context,
                    ).copyWith(textScaler: TextScaler.linear(textScale)),
                    child: const HomeScreen(),
                  ),
                ),
              ),
      ),
    );
    // Pending network checks and SOS use animated indicators.
    await tester.pump();
  }

  Future<void> confirmSos(WidgetTester tester) async {
    await tester.longPress(find.text('SOS'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Да, отправить'));
    await tester.pump();
  }

  testWidgets('checks server before reporting connection and allows retry', (
    tester,
  ) async {
    final first = Completer<Response<dynamic>>();
    final retry = Completer<Response<dynamic>>();
    var requests = 0;
    when(
      () => dio.get('/child/me', options: any(named: 'options')),
    ).thenAnswer((_) => requests++ == 0 ? first.future : retry.future);

    await openHome(tester);
    expect(find.text('Проверяем связь…'), findsOneWidget);
    expect(find.text('Сервер ответил'), findsNothing);
    first.completeError(
      DioException(
        requestOptions: RequestOptions(path: '/child/me'),
        type: DioExceptionType.connectionTimeout,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Связь не проверена'), findsOneWidget);
    verifyNever(storage.clearAll);

    await tester.tap(find.byTooltip('Проверить связь'));
    await tester.pump();
    expect(find.text('Проверяем связь…'), findsOneWidget);
    retry.complete(_meResponse('Семья Ивановых'));
    await tester.pumpAndSettle();
    expect(find.text('Сервер ответил'), findsOneWidget);
    expect(find.text('Семья Ивановых'), findsOneWidget);
    expect(requests, 2);
    expect(locationCalls.where((name) => name == 'startService'), hasLength(1));
  });

  testWidgets('revoked token still clears storage and opens onboarding', (
    tester,
  ) async {
    when(() => dio.get('/child/me', options: any(named: 'options'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/child/me'),
        response: Response(
          requestOptions: RequestOptions(path: '/child/me'),
          statusCode: 401,
        ),
      ),
    );
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
        GoRoute(
          path: '/onboarding',
          builder: (_, _) => const Scaffold(body: Text('Привязка')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await openHome(tester, router: router);
    await tester.pumpAndSettle();
    expect(find.text('Привязка'), findsOneWidget);
    verify(storage.clearAll).called(1);
    expect(locationCalls, contains('deviceUnlinked'));
  });

  testWidgets('late revocation from a closed home cannot clear the token', (
    tester,
  ) async {
    final abandoned = Completer<Response<dynamic>>();
    var requests = 0;
    when(() => dio.get('/child/me', options: any(named: 'options'))).thenAnswer(
      (_) async =>
          requests++ == 0 ? abandoned.future : _meResponse('Новая семья'),
    );
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
        GoRoute(
          path: '/other',
          builder: (_, _) => const Scaffold(body: Text('Другой экран')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await openHome(tester, router: router);
    router.go('/other');
    await tester.pumpAndSettle();
    router.go('/home');
    await tester.pumpAndSettle();
    expect(find.text('Новая семья'), findsOneWidget);

    final request = RequestOptions(path: '/child/me');
    abandoned.completeError(
      DioException(
        requestOptions: request,
        response: Response(requestOptions: request, statusCode: 401),
      ),
    );
    await tester.pumpAndSettle();
    verifyNever(storage.clearAll);
    expect(locationCalls, isNot(contains('deviceUnlinked')));
  });

  testWidgets(
    'SOS requires hold and confirmation and shows server acceptance',
    (tester) async {
      final result = Completer<Response<dynamic>>();
      when(
        () => dio.post(
          '/sos',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer((_) => result.future);
      await openHome(tester);

      await tester.tap(find.text('SOS'));
      await tester.pumpAndSettle();
      expect(find.text('Отправить SOS?'), findsNothing);
      await tester.longPress(find.text('SOS'));
      await tester.pumpAndSettle();
      expect(find.text('Отправить SOS?'), findsOneWidget);
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      verifyNever(
        () => dio.post(
          '/sos',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      );

      await confirmSos(tester);
      expect(find.text('Отправляем сигнал…'), findsOneWidget);
      await tester.longPress(find.text('SOS'));
      await tester.pump();
      expect(find.text('Отправить SOS?'), findsNothing);
      result.complete(
        Response(
          requestOptions: RequestOptions(path: '/sos'),
          data: {'sosId': 'test', 'createdAt': '2026-11-20T00:00:00Z'},
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Сигнал принят'), findsOneWidget);
      verify(
        () => dio.post(
          '/sos',
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).called(1);
    },
  );

  testWidgets('failed SOS shows an error and keeps the button available', (
    tester,
  ) async {
    when(
      () => dio.post(
        '/sos',
        data: any(named: 'data'),
        options: any(named: 'options'),
      ),
    ).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/sos'),
        type: DioExceptionType.connectionError,
      ),
    );
    await openHome(tester);
    await confirmSos(tester);
    await tester.pumpAndSettle();
    expect(find.textContaining('Не удалось отправить SOS'), findsOneWidget);
    expect(find.text('Сигнал принят'), findsNothing);
    await tester.longPress(find.text('SOS'));
    await tester.pumpAndSettle();
    expect(find.text('Отправить SOS?'), findsOneWidget);
  });

  testWidgets(
    'screen reader can open SOS confirmation with an activate action',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await openHome(tester);
        tester.semantics.tap(find.semantics.byLabel('SOS'));
        await tester.pumpAndSettle();
        expect(find.text('Отправить SOS?'), findsOneWidget);
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets('keyboard focus can open SOS confirmation', (tester) async {
    await openHome(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab); // Проверка связи
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.tab); // SOS
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Отправить SOS?'), findsOneWidget);
  });

  testWidgets('dial button opens the empty system dialer', (tester) async {
    final calls = <MethodCall>[];
    mockChannel(_dialer.name, (call) async {
      calls.add(call);
      return true;
    });
    await openHome(tester);
    await tester.tap(find.text('Позвонить'));
    await tester.pumpAndSettle();
    expect(calls.single.method, 'openDialer');
    expect(calls.single.arguments, isNull);
  });

  testWidgets('shows feedback when no dialer is available', (tester) async {
    mockChannel(_dialer.name, (_) async => false);
    await openHome(tester);
    await tester.tap(find.text('Позвонить'));
    await tester.pumpAndSettle();
    expect(
      find.text('Не удалось открыть приложение «Телефон»'),
      findsOneWidget,
    );
  });

  testWidgets('long press on update row opens diagnostics', (tester) async {
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
        GoRoute(
          path: '/debug',
          builder: (_, _) => const Scaffold(body: Text('Диагностика')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await openHome(tester, router: router);
    await tester.ensureVisible(find.text('Проверить обновления'));
    await tester.longPress(find.text('Проверить обновления'));
    await tester.pumpAndSettle();
    expect(find.text('Диагностика'), findsOneWidget);
  });

  testWidgets(
    'SOS stays visible at 2x text with long family name and warnings',
    (tester) async {
      tester.view
        ..physicalSize = const Size(320, 460)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      mockChannel('flutter.baseflow.com/permissions/methods', (call) async {
        return call.arguments == Permission.locationAlways.value ||
                call.arguments == Permission.activityRecognition.value
            ? 0
            : 1;
      });
      when(
        () => dio.get('/child/me', options: any(named: 'options')),
      ).thenAnswer((_) async => _meResponse('Очень длинное имя семьи ' * 20));

      await openHome(tester, textScale: 2);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('SOS').hitTestable(), findsOneWidget);
      final permissions = find.text('Не все разрешения настроены');
      expect(permissions.hitTestable(), findsNothing);
      await tester.ensureVisible(permissions);
      await tester.pumpAndSettle();
      expect(permissions.hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

Response<dynamic> _meResponse(String family) => Response(
  requestOptions: RequestOptions(path: '/child/me'),
  data: {
    'family': {'name': family},
  },
);
