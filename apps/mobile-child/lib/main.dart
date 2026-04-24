import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'background/location_entry.dart' as bg;
import 'core/diag/diag_channel.dart';
import 'core/storage/secure_storage_service.dart';
import 'features/sound_around/sound_around_entry.dart' as sa;

// Держим ссылки на entrypoints чтобы AOT tree-shaker не выкинул их из
// release-snapshot. `@pragma('vm:entry-point')` в некоторых версиях Flutter
// не спасает, если символ никем не импортирован.
// Plan E 2026-04-24: без этой ссылки `soundAroundEntryPoint` удалялся в release
// APK → SoundAroundService.executeDartEntrypoint не находил функцию →
// Dart isolate не стартовал → логи `[sound_around] soundAroundEntryPoint...`
// не появлялись, сессия expire'илась с PARENT_TIMEOUT. В debug билде работало.
// ignore: unused_element
final _keepEntrypoints = <Function>[bg.locationEntryPoint, sa.soundAroundEntryPoint];

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Если device уже приклеймлен — при повторном запуске сразу
  // в /home, а не на экран «Подключиться».
  final token = await SecureStorageService().readDeviceToken();
  final hasToken = token != null && token.isNotEmpty;
  unawaited(diagLog('ui', 'app started, hasToken=$hasToken'));
  final initialLocation = hasToken ? '/home' : '/onboarding';
  runApp(ProviderScope(child: GmdChildApp(initialLocation: initialLocation)));
}
