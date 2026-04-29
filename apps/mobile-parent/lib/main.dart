import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Русские месяцы/дни недели для DateFormat — используется в child_detail.
  await initializeDateFormatting('ru_RU');
  // v0.46: Firebase Core init для FCM. Best-effort — если google-services.json
  // отсутствует или Play Services недоступны, app продолжает работать без push.
  try {
    await Firebase.initializeApp();
  } catch (e) {
    debugPrint('[GMD] Firebase init failed (continuing without FCM): $e');
  }
  runApp(const ProviderScope(child: GmdParentApp()));
}
