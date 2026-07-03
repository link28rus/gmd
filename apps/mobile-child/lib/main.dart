import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'background/location_entry.dart' as bg;
import 'core/diag/diag_channel.dart';
import 'core/fcm/fcm_registrar.dart';
import 'core/native/escape_channel.dart';
import 'core/push/rustore_push_registrar.dart';
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
  // v0.37: Firebase init для FCM (high-priority push команд от backend).
  // Best-effort: если упадёт (нет Google Play Services / нет google-services.json) —
  // poll-fallback продолжит работать, как в v0.36.
  try {
    await Firebase.initializeApp();
    unawaited(diagLog('ui', 'Firebase initialized'));
  } catch (e) {
    unawaited(diagLog('ui', 'Firebase init FAILED: $e (poll-fallback ok)'));
  }
  // v0.38 escape hatch: сначала проверяем — не находится ли устройство в
  // escape-mode (родитель удалил ребёнка / сделал reset-device). Если да —
  // показываем спецэкран сразу, минуя обычный flow. Не зависит от наличия
  // токена (creds к этому моменту уже стёрты native-слоем).
  bool escapeMode = false;
  try {
    escapeMode = await EscapeChannel.isInEscapeMode();
  } catch (e) {
    unawaited(diagLog('ui', 'EscapeChannel.isInEscapeMode failed: $e'));
  }
  if (escapeMode) {
    unawaited(diagLog('ui', 'app started in ESCAPE MODE — showing escape screen'));
    runApp(ProviderScope(child: PeriscopChildApp(initialLocation: '/escape')));
    return;
  }

  // Если device уже приклеймлен — при повторном запуске сразу
  // в /home, а не на экран «Подключиться».
  final token = await SecureStorageService().readDeviceToken();
  final hasToken = token != null && token.isNotEmpty;
  unawaited(diagLog('ui', 'app started, hasToken=$hasToken'));
  // v0.37: запустить FCM token-регистрацию в фоне (не блокирует startup).
  // Регистрирует только если есть device-token (т.е. claim уже был).
  if (hasToken) {
    unawaited(FcmRegistrar.registerInBackground());
    // v0.51 (lesson #24): параллельно регистрируем RuStore Push token, если
    // на устройстве есть RuStore client. Не блокирует startup.
    unawaited(RuStorePushRegistrar.registerInBackground());
  }
  final initialLocation = hasToken ? '/home' : '/onboarding';
  runApp(ProviderScope(child: PeriscopChildApp(initialLocation: initialLocation)));
}
