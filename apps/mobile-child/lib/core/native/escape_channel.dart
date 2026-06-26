import 'package:flutter/services.dart';

/// v0.38 ESCAPE HATCH bridge: для UI чтобы:
///   1. Узнать, мы в escape-mode (показать спецэкран вместо обычного home)
///   2. Открыть карточку приложения чтобы пользователь смог Uninstall
///   3. Опционально triggerнуть probe сразу (например при возвращении из background)
class EscapeChannel {
  static const MethodChannel _ch = MethodChannel('pro.periscop.child/escape');

  /// True если устройство в escape-mode (родитель удалил ребёнка / сделал
  /// reset-device, и backend подтвердил probe'ом). Native снял Device Admin
  /// и стёр creds, UI должен показать EscapeScreen.
  static Future<bool> isInEscapeMode() async {
    final v = await _ch.invokeMethod<bool>('isInEscapeMode');
    return v ?? false;
  }

  /// Причина escape (для UI: «Родитель удалил ребёнка» / «Устройство отвязано»).
  /// Возвращает 'device_revoked' / 'child_deleted' / null.
  static Future<String?> lastReason() async {
    return await _ch.invokeMethod<String>('lastReason');
  }

  /// Дёрнуть probe немедленно (для retry-кнопки в EscapeScreen или при resume).
  /// Возвращает имя enum (ACTIVE / REVOKED / DELETED / UNKNOWN / NETWORK_ERROR).
  static Future<String?> probeNow() async {
    return await _ch.invokeMethod<String>('probeNow');
  }

  /// Открыть Settings → Apps → Перископ Ребёнка карточку (для кнопки «Удалить» в EscapeScreen).
  static Future<void> openAppDetails() async {
    await _ch.invokeMethod<void>('openAppDetails');
  }
}
