import 'package:flutter/services.dart';

// Мост в Kotlin-side DiagLog: native пишет строки в файл и отдаёт их на
// экран /debug. Используем во всех Dart-изолятах (UI, headless геолокации,
// «Звук вокруг») — канал зарегистрирован в каждом движке (DiagChannel.kt).
// Не падаем если канал недоступен — диагностика не должна ломать продакшен.
const _channel = MethodChannel('pro.periscop.child/diag');

Future<void> diagLog(String tag, String msg) async {
  try {
    await _channel.invokeMethod('write', {'tag': tag, 'msg': msg});
  } catch (_) {
    // silent — диагностический лог не должен валить приложение
  }
}

/// v0.60.0: подробная (DEBUG) запись. Native пишет её, только если категория
/// тега включена в настройках журнала (DiagConfig.debug) и срок не истёк.
Future<void> diagDebug(String tag, String msg) async {
  try {
    await _channel.invokeMethod('debug', {'tag': tag, 'msg': msg});
  } catch (_) {}
}

/// v0.60.0: поставить отправку журнала на сервер (WorkManager, уйдёт при
/// появлении сети). `reason: 'manual'` — по команде UPLOAD_DIAG (`commandId`)
/// или кнопкой на /debug; `reason: 'auto'` — при сбое (`trigger`), с лимитом
/// частоты на native-стороне. true — отправка поставлена в очередь.
Future<bool> diagUpload({
  required String reason,
  String? trigger,
  String? commandId,
}) async {
  try {
    final ok = await _channel.invokeMethod<bool>('upload', {
      'reason': reason,
      'trigger': ?trigger,
      'commandId': ?commandId,
    });
    return ok ?? false;
  } catch (_) {
    return false;
  }
}

/// v0.60.0: текущие настройки журнала одной строкой (для экрана /debug).
Future<String> diagConfigSummary() async {
  try {
    return await _channel.invokeMethod<String>('configSummary') ?? '';
  } catch (_) {
    return '';
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
