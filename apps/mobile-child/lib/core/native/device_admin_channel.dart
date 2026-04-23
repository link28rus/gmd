import 'package:flutter/services.dart';

// Канал L1/L2-защиты от удаления.
//
// L1 — Device Admin: isActive / requestActivation / openSettings.
// L2 — AccessibilityService + PIN-lock:
//   isAccessibilityEnabled / openAccessibilitySettings.
// saveNativeCreds — кладёт deviceToken + apiBaseUrl в plain SharedPreferences,
// чтобы нативная PinLockActivity могла делать HTTP-запрос без Flutter engine.
class DeviceAdminChannel {
  static const MethodChannel _channel =
      MethodChannel('ru.link28rus.gmd.child/protection');

  Future<bool> isActive() async {
    final result = await _channel.invokeMethod<bool>('isActive');
    return result ?? false;
  }

  // Сам себя отзывает из DeviceAdmin (removeActiveAdmin). Вызывается когда
  // родитель выключил тумблер защиты в кабинете — после этого приложение
  // можно удалить обычным способом.
  Future<void> deactivate() async {
    await _channel.invokeMethod('deactivate');
  }

  // Обновляет native-кеш protection-флага: GmdAccessibilityService читает
  // его при каждом onAccessibilityEvent и ранним return отключает L2, если
  // защита выключена на backend.
  Future<void> setProtectionCache(bool enabled) async {
    await _channel.invokeMethod('setProtectionCache', {'enabled': enabled});
  }

  Future<void> requestActivation() async {
    await _channel.invokeMethod('requestActivation');
  }

  Future<void> openSettings() async {
    await _channel.invokeMethod('openSettings');
  }

  Future<bool> isAccessibilityEnabled() async {
    final result = await _channel.invokeMethod<bool>('isAccessibilityEnabled');
    return result ?? false;
  }

  Future<void> openAccessibilitySettings() async {
    await _channel.invokeMethod('openAccessibilitySettings');
  }

  Future<void> openAppDetailsSettings() async {
    await _channel.invokeMethod('openAppDetailsSettings');
  }

  Future<String> deviceManufacturer() async {
    final m = await _channel.invokeMethod<String>('deviceManufacturer');
    return (m ?? '').toLowerCase();
  }

  Future<void> saveNativeCreds({
    required String deviceToken,
    required String apiBaseUrl,
  }) async {
    await _channel.invokeMethod('saveNativeCreds', {
      'deviceToken': deviceToken,
      'apiBaseUrl': apiBaseUrl,
    });
  }
}
