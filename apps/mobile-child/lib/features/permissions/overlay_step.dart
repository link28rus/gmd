import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/overlay';

/// v0.68.0 — шаг «поверх других приложений» (SYSTEM_ALERT_WINDOW).
///
/// Зачем: Android 14+ не даёт микрофон службе, запущенной из фона. После
/// перезагрузки «Звук вокруг» не поднялся бы сам, пока ребёнок не коснётся
/// приложения. Разрешение «поверх других приложений» даёт право запустить
/// активность из фона — после загрузки приложение на долю секунды показывает
/// служебную активность, этого достаточно, чтобы система выдала микрофон, и
/// «Звук вокруг» работает без участия ребёнка. Подтверждено на эмуляторе
/// Android 15, см. docs/superpowers/specs/2026-09-30-sound-around-autostart.md.
///
/// systemAlertWindow — специальное разрешение: системного диалога нет, только
/// экран настроек. Поэтому шаг всегда открывает настройки и перепроверяет
/// статус по возвращении (lifecycle resumed), как ветка permanentlyDenied у
/// других шагов.
class OverlayStep extends StatefulWidget {
  const OverlayStep({super.key});

  @override
  State<OverlayStep> createState() => _OverlayStepState();
}

class _OverlayStepState extends State<OverlayStep> with WidgetsBindingObserver {
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
      _checkAfterReturn();
    }
  }

  Future<void> _checkAfterReturn() async {
    final status = await Permission.systemAlertWindow.status;
    if (!mounted) return;
    if (status.isGranted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Показ поверх других приложений разрешён ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Разрешение пока не включено. Без него «Звук вокруг» не поднимется '
            'сам после перезагрузки телефона.',
          ),
          duration: Duration(seconds: 4),
          backgroundColor: Colors.orange,
        ),
      );
    }
  }

  Future<void> _request(BuildContext context) async {
    final status = await Permission.systemAlertWindow.status;
    if (!context.mounted) return;
    if (status.isGranted) {
      _goNext();
      return;
    }
    // Специальное разрешение — диалога нет, request() открывает экран настроек
    // «Поверх других приложений». Ждём возвращения и перепроверяем на resume.
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Найди в списке «Перископ» и включи переключатель. '
          'После этого вернись — я перепроверю.',
        ),
        duration: Duration(seconds: 5),
      ),
    );
    _waitingForReturn = true;
    await Permission.systemAlertWindow.request();
  }

  Future<void> _confirmSkip(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Пропустить разрешение?'),
        content: const Text(
          'Без него «Звук вокруг» перестанет работать после каждой перезагрузки '
          'телефона, пока ты не откроешь приложение вручную. Включить можно '
          'потом в настройках.\n\nВсё равно пропустить?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Назад'),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Да, пропустить'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) _goNext();
  }

  void _goNext() {
    if (mounted) GoRouter.of(context).go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Показ поверх других приложений',
      description:
          'Нужно, чтобы «Звук вокруг» продолжал работать сам после перезагрузки '
          'телефона. Без этого разрешения после каждой перезагрузки функцию '
          'пришлось бы включать вручную, открывая приложение.\n\n'
          'По нажатию откроется системный экран — найди «Перископ» в списке и '
          'включи переключатель, затем вернись назад.',
      onRequest: () => _request(context),
      onSkip: () => _confirmSkip(context),
      actionLabel: 'Открыть настройки',
    );
  }
}
