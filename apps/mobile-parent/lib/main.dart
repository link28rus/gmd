import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Русские месяцы/дни недели для DateFormat — используется в child_detail.
  await initializeDateFormatting('ru_RU');
  runApp(const ProviderScope(child: GmdParentApp()));
}
