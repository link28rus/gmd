import 'package:flutter/services.dart';

/// Bridge к native-каналу `pro.periscop.child/app_control` (MainActivity.kt).
///
/// Имя канала историческое (v0.38 screen-time). Блокировка приложений и
/// экранное время временно отключены в v0.58.0 — в канале остался только
/// флаг «первый запуск после обновления APK». При возврате функций методы
/// восстановить из git.
///
/// Только UI-isolate. Методы могут throw PlatformException — caller обязан
/// обработать.
class AppControlChannel {
  static const MethodChannel _ch =
      MethodChannel('pro.periscop.child/app_control');

  /// Задача #61: one-shot consume флага «первый запуск после обновления APK».
  /// Native [PostUpdateGuard] детектит смену versionCode в `MainActivity.onCreate`
  /// и выставляет flag pending=true. Этот метод возвращает [PostUpdateInfo]
  /// с from/to versionName ОДИН РАЗ, потом флаг очищается. Если обновления
  /// не было (или флаг уже consume'нут) → null.
  ///
  /// На HyperOS/MIUI после sideload-обновления может слетать Device Admin
  /// (известный bug OS). Caller использует этот флаг как trigger для
  /// активного rescue-flow вместо пассивного баннера.
  static Future<PostUpdateInfo?> consumePostUpdateFlag() async {
    final raw =
        await _ch.invokeMethod<Map<dynamic, dynamic>>('consumePostUpdateFlag');
    if (raw == null) return null;
    return PostUpdateInfo(
      fromVersionName: raw['fromVersionName'] as String? ?? '',
      toVersionName: raw['toVersionName'] as String? ?? '',
    );
  }
}

/// Задача #61: payload one-shot pending-флага после обновления APK.
class PostUpdateInfo {
  const PostUpdateInfo({
    required this.fromVersionName,
    required this.toVersionName,
  });

  final String fromVersionName;
  final String toVersionName;

  @override
  String toString() => 'PostUpdateInfo($fromVersionName → $toVersionName)';
}
