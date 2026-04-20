import 'package:flutter/services.dart';

class LocationServiceChannel {
  static const MethodChannel _channel =
      MethodChannel('ru.link28rus.gmd.child/location');

  void onLocation(void Function(Map<String, dynamic>) handler) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onLocation' && call.arguments is Map) {
        handler(Map<String, dynamic>.from(call.arguments as Map));
      }
    });
  }

  Future<void> startService() async {
    await _channel.invokeMethod('startService');
  }

  Future<void> stopService() async {
    await _channel.invokeMethod('stopService');
  }
}
