import 'package:flutter/services.dart';

// Мост в Kotlin-side DiagLog для mobile-parent. Используется из UI-isolate;
// fallback'ит в no-op если канал недоступен (widget-тесты, web).
const _channel = MethodChannel('ru.link28rus.gmd.parent/diag');

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
