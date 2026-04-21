import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/diag/diag_channel.dart';
import 'core/storage/secure_storage_service.dart';

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
