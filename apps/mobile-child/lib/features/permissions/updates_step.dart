import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/updates/app_update_channel.dart';
import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/updates';

/// v0.56.0 — шаг мастера для «Установки неизвестных приложений».
///
/// Приложение обновляет само себя с нашего сервера (AppUpdater.kt). Без этого
/// разрешения Android не даст поставить скачанную версию, и обновление будет
/// ждать, пока кто-то нажмёт кнопку на телефоне ребёнка. Проще выдать один раз
/// при настройке телефона — тогда обновления встают молча.
///
/// Открываем `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` с `package:<our>`,
/// на возврате перепроверяем `canRequestPackageInstalls` (паттерн OverlayStep).
class UpdatesStep extends StatefulWidget {
  const UpdatesStep({super.key});

  @override
  State<UpdatesStep> createState() => _UpdatesStepState();
}

class _UpdatesStepState extends State<UpdatesStep> with WidgetsBindingObserver {
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
    final granted = await AppUpdateChannel.canRequestInstall();
    if (!mounted) return;
    if (granted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Обновления будут ставиться сами ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Без этого разрешения обновление придётся подтверждать '
            'на телефоне вручную.',
          ),
          duration: Duration(seconds: 4),
        ),
      );
    }
  }

  Future<void> _openSettings(BuildContext context) async {
    final granted = await AppUpdateChannel.canRequestInstall();
    if (!context.mounted) return;
    if (granted) {
      _goNext();
      return;
    }
    _waitingForReturn = true;
    try {
      await AppUpdateChannel.openInstallSettings();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть настройки: ${e.message}')),
      );
    }
  }

  void _goNext() {
    if (mounted) GoRouter.of(context).go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Обновления приложения',
      description:
          'Новые версии «Перископа» загружаются и устанавливаются сами — '
          'ничего нажимать не нужно.\n\n'
          'Для этого Android просит один раз разрешить приложению установку '
          'обновлений. Откройте настройку и включите тумблер '
          '«Разрешить установку из этого источника» (на Xiaomi — '
          '«Установка неизвестных приложений»).\n\n'
          'Без этого разрешения каждое обновление придётся подтверждать на '
          'телефоне вручную.',
      onRequest: () => _openSettings(context),
      onSkip: _goNext,
      actionLabel: 'Разрешить обновления',
    );
  }
}
