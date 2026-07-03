import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/native/app_control_channel.dart';
import 'permissions_wizard.dart';

/// v0.39.5 Phase 6.2 — onboarding шаг для гранта SYSTEM_ALERT_WINDOW.
///
/// Без SAW perm `WindowManager.addView` с `TYPE_APPLICATION_OVERLAY` бросает
/// BadTokenException → визуальный экран «🔒 Телефон заблокирован» не
/// показывается. Без него блокировка работает (a11y `GLOBAL_ACTION_HOME` всё
/// равно выкидывает на launcher), но ребёнок не понимает почему его app
/// закрылся.
///
/// Открываем `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` с `package:<our>` —
/// на большинстве OEM Android открывает прямо на нашем app в списке
/// «Спецдоступ → Поверх других приложений». Пользователь включает тумблер.
///
/// Lifecycle resume → перепроверяем `canDrawOverlays`. Если granted — переходим
/// к следующему шагу wizard'а (микрофон). Если нет — позволяем skip
/// (это не блокер для остальной функциональности).
class OverlayStep extends StatefulWidget {
  const OverlayStep({super.key});

  @override
  State<OverlayStep> createState() => _OverlayStepState();
}

class _OverlayStepState extends State<OverlayStep>
    with WidgetsBindingObserver {
  bool _waitingForReturn = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _waitingForReturn) {
      _waitingForReturn = false;
      unawaited(_checkAfterReturn());
    }
  }

  Future<void> _checkAfterReturn() async {
    final granted = await AppControlChannel.canDrawOverlays();
    if (!mounted) return;
    if (granted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Экран блокировки активен ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Без этого права блокировка всё равно работает (приложение закроется), '
            'но не будет красивого экрана с таймером.',
          ),
          duration: Duration(seconds: 4),
        ),
      );
    }
  }

  Future<void> _openOverlay(BuildContext context) async {
    final granted = await AppControlChannel.canDrawOverlays();
    if (!context.mounted) return;
    if (granted) {
      _goNext();
      return;
    }
    _waitingForReturn = true;
    try {
      await AppControlChannel.openOverlaySettings();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть настройки: ${e.message}')),
      );
    }
  }

  void _goNext() {
    if (mounted) GoRouter.of(context).go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 8,
      totalSteps: 9,
      title: 'Экран блокировки',
      description:
          'Когда родитель включит блокировку и ты попробуешь открыть запрещённое '
          'приложение — на экране появится сообщение «Телефон заблокирован» с '
          'таймером, сколько ещё ждать.\n\n'
          'Чтобы это работало, нужно разрешение «Поверх других приложений» '
          '(оно же «Отображение поверх других окон»). Открой настройку, найди '
          'в списке «Перископ Ребёнка» и включи тумблер.\n\n'
          'Без этого блокировка тоже работает — приложение просто закроется, '
          'но без красивого экрана с объяснением.',
      onRequest: () => _openOverlay(context),
      onSkip: _goNext,
      actionLabel: 'Разрешить экран блокировки',
    );
  }
}
