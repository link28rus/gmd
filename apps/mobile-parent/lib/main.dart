import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';
import 'core/config/env.dart';
import 'core/diag/diag_channel.dart';
import 'core/updates/app_update_channel.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Русские месяцы/дни недели для DateFormat — используется в child_detail.
  await initializeDateFormatting('ru_RU');
  // v0.46: Firebase Core init для FCM. Best-effort — если google-services.json
  // отсутствует или Play Services недоступны, app продолжает работать без push.
  try {
    await Firebase.initializeApp();
  } catch (e) {
    debugPrint('[Periscop] Firebase init failed (continuing without FCM): $e');
  }
  // v0.56.0 самообновление: адрес API для фонового AppUpdateWorker'а и сама
  // периодическая проверка — на любом запуске, даже без входа в аккаунт.
  if (Platform.isAndroid) {
    unawaited(AppUpdateChannel.configure(apiBaseUrl).catchError(
      (Object e) => diagLog('updates', 'configure failed: $e'),
    ));
  }
  runApp(const ProviderScope(child: PeriscopParentApp()));
}
