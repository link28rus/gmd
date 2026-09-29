import 'dart:io' show Platform;

import 'package:flutter/services.dart';

/// v0.66.0: сведения об устройстве из Kotlin (`MainActivity`, канал
/// `pro.periscop.parent/device`).
class DeviceChannel {
  static const MethodChannel _ch = MethodChannel('pro.periscop.parent/device');

  /// IANA-пояс телефона (`TimeZone.getDefault().id`, например
  /// «Asia/Vladivostok»). null — канал недоступен (iOS, тесты) или пусто.
  /// Нужен расписанию и сроку геозон: backend считает время в поясе зоны.
  static Future<String?> timeZone() async {
    if (!Platform.isAndroid) return null;
    try {
      final tz = await _ch.invokeMethod<String>('timeZone');
      return (tz == null || tz.isEmpty) ? null : tz;
    } catch (_) {
      return null;
    }
  }
}
