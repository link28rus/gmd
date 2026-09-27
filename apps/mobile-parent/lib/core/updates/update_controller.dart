import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/env.dart';
import '../diag/diag_channel.dart';
import 'app_update_channel.dart';

/// v0.56.0 — состояние самообновления для баннера на home.
///
/// Вся работа — в нативном `AppUpdater.kt`; контроллер только запускает
/// проверку при открытии приложения и опрашивает статус, пока идёт загрузка.
/// Фоновую проверку раз в 6 часов делает `AppUpdateWorker` (ставится в
/// [checkOnOpen] через `configure`).
class UpdateController extends StateNotifier<AppUpdateStatus?> {
  UpdateController() : super(null);

  /// Не дёргать сервер на каждый возврат в приложение.
  static const _recheckAfter = Duration(minutes: 15);

  Timer? _poll;
  bool _configured = false;

  /// При открытии и при возврате приложения на экран.
  Future<void> checkOnOpen() async {
    if (!Platform.isAndroid) return;
    try {
      await _ensureConfigured();
      var s = await AppUpdateChannel.getStatus();
      final last = s.lastCheckAt;
      final age = last == null ? null : DateTime.now().difference(last);
      // Отрицательный возраст — часы перевели назад; без этого проверки при
      // открытии встали бы, пока время не догонит записанное.
      final stale = age == null || age.isNegative || age > _recheckAfter;
      if (!s.isBusy && stale) s = await AppUpdateChannel.checkNow();
      _set(s);
    } catch (e) {
      unawaited(diagLog('updates', 'checkOnOpen failed: $e'));
    }
  }

  /// Ручная проверка (нажатие на версию в шапке / пункт меню) — мимо
  /// интервала [_recheckAfter]. Ждёт окончания проверки и возвращает итог для
  /// сообщения пользователю; загрузку дальше показывает баннер. `null` — не
  /// Android или канал упал.
  Future<AppUpdateStatus?> checkManually() async {
    if (!Platform.isAndroid) return null;
    try {
      await _ensureConfigured();
      var s = await AppUpdateChannel.checkNow();
      _set(s);
      // Таймауты запроса в AppUpdater — 15 с на соединение и чтение.
      final deadline = DateTime.now().add(const Duration(seconds: 40));
      while (s.phase == AppUpdatePhase.checking &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        s = await AppUpdateChannel.getStatus();
        _set(s);
      }
      return s;
    } catch (e) {
      unawaited(diagLog('updates', 'checkManually failed: $e'));
      return null;
    }
  }

  /// Кнопка «Обновить» / «Установить».
  Future<void> install() async {
    try {
      _set(await AppUpdateChannel.installNow());
    } catch (e) {
      unawaited(diagLog('updates', 'install failed: $e'));
    }
  }

  /// Кнопка «Повторить»: упали на установке — ставим снова, иначе проверяем.
  Future<void> retry() async {
    try {
      final s = state;
      _set(s?.lastErrorStage == 'install'
          ? await AppUpdateChannel.installNow()
          : await AppUpdateChannel.checkNow());
    } catch (e) {
      unawaited(diagLog('updates', 'retry failed: $e'));
    }
  }

  /// Приложение ушло в фон — опрос не нужен.
  void pause() {
    _poll?.cancel();
    _poll = null;
  }

  Future<void> _ensureConfigured() async {
    if (_configured) return;
    await AppUpdateChannel.configure(apiBaseUrl);
    _configured = true;
  }

  void _set(AppUpdateStatus s) {
    if (!mounted) return;
    state = s;
    if (s.isBusy) {
      _poll ??= Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    } else {
      pause();
    }
  }

  Future<void> _tick() async {
    try {
      _set(await AppUpdateChannel.getStatus());
    } catch (_) {
      pause();
    }
  }

  @override
  void dispose() {
    pause();
    super.dispose();
  }
}

/// Lifetime = приложение: переходы home → /debug → home не сбрасывают состояние.
final updateControllerProvider =
    StateNotifierProvider<UpdateController, AppUpdateStatus?>((ref) {
  return UpdateController();
});
