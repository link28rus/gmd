import 'package:flutter/services.dart';

// Канал L1-защиты от удаления. Ручка к DevicePolicyManager.isAdminActive и
// системному диалогу ACTION_ADD_DEVICE_ADMIN. Сам результат активации —
// асинхронный (системный модальный диалог), после возврата в приложение Dart
// повторно опрашивает isActive.
class DeviceAdminChannel {
  static const MethodChannel _channel =
      MethodChannel('ru.link28rus.gmd.child/protection');

  Future<bool> isActive() async {
    final result = await _channel.invokeMethod<bool>('isActive');
    return result ?? false;
  }

  Future<void> requestActivation() async {
    await _channel.invokeMethod('requestActivation');
  }

  Future<void> openSettings() async {
    await _channel.invokeMethod('openSettings');
  }
}
