import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/storage/secure_storage_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Если device уже приклеймлен — при повторном запуске сразу
  // в /home, а не на экран «Подключиться».
  final token = await SecureStorageService().readDeviceToken();
  final initialLocation = (token != null && token.isNotEmpty) ? '/home' : '/onboarding';
  runApp(ProviderScope(child: GmdChildApp(initialLocation: initialLocation)));
}
