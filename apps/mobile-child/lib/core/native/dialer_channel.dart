import 'package:flutter/services.dart';

class DialerChannel {
  static const _channel = MethodChannel('pro.periscop.child/dialer');

  static Future<bool> open() async {
    try {
      return await _channel.invokeMethod<bool>('openDialer') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
