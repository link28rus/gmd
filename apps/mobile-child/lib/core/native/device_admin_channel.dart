import 'package:flutter/services.dart';

// Канал L1 Device Admin: активация/деактивация + синхронизация
// protection-флага в native кеш.
//
// L2 PIN-lock (AccessibilityService + PinLockActivity) удалён в v0.29.2 —
// больше нет вызовов isAccessibilityEnabled / openAccessibilitySettings.
// Защита от удаления держится ТОЛЬКО на Device Admin; родитель управляет
// тумблером в кабинете, при OFF приложение само отзывает admin.
// saveNativeCreds остаётся — deviceToken+apiBaseUrl нужны background
// сервису и potential native-компонентам без Flutter engine.
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

  // Обновляет native-кеш protection-флага. В v0.29.2 он больше не читается
  // AccessibilityService (тот стал no-op), но оставлен для будущих native-
  // компонентов и чтобы downgrade на v0.29.1 работал корректно.
  Future<void> setProtectionCache(bool enabled) async {
    await _channel.invokeMethod('setProtectionCache', {'enabled': enabled});
  }

  Future<void> requestActivation() async {
    await _channel.invokeMethod('requestActivation');
  }

  Future<void> openSettings() async {
    await _channel.invokeMethod('openSettings');
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
