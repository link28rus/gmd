import 'package:flutter/services.dart';

// Мост в Kotlin-side DiagLog: native пишет строки в файл и отдаёт их на
// экран /debug. Используем в обоих Dart-изолятах (UI и headless background).
// Не падаем если канал недоступен — диагностика не должна ломать продакшен.
const _channel = MethodChannel('ru.link28rus.gmd.child/diag');

Future<void> diagLog(String tag, String msg) async {
  try {
    await _channel.invokeMethod('write', {'tag': tag, 'msg': msg});
  } catch (_) {
    // silent — диагностический лог не должен валить приложение
  }
}

Future<String> diagRead() async {
  try {
    final result = await _channel.invokeMethod<String>('read');
    return result ?? '';
  } catch (_) {
    return '';
  }
}

Future<void> diagClear() async {
  try {
    await _channel.invokeMethod('clear');
  } catch (_) {}
}
