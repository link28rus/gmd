import 'package:flutter/services.dart';

class DeviceAdminChannel {
  static const _ch = MethodChannel('ru.link28rus.gmd.child/device_admin');
  Future<String> request() async => await _ch.invokeMethod<String>('request') ?? 'unknown';
  Future<bool> isActive() async => await _ch.invokeMethod<bool>('isActive') ?? false;
}
