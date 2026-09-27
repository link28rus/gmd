import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/native/device_admin_channel.dart';
import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/devadmin';

/// Шаг активации Device Admin — защита приложения от удаления.
///
/// Пока Device Admin активен, Android блокирует стандартный Uninstall (Settings
/// → Apps → «Перископ Ребёнка» показывает «Отключить администратора устройства»
/// вместо «Удалить»). Активация — через системный диалог `ACTION_ADD_DEVICE_ADMIN`.
///
/// Раньше этого шага в мастере не было — вместо него стоял placeholder
/// («Продолжить (devadmin placeholder)»), а реальная активация всплывала
/// bottom-sheet'ом уже на главном экране. Теперь это полноценный шаг мастера,
/// симметричный [AccessibilityStep]: system dialog + resume-recheck + Xiaomi
/// restricted-settings flow.
class DeviceAdminStep extends StatefulWidget {
  const DeviceAdminStep({super.key});

  @override
  State<DeviceAdminStep> createState() => _DeviceAdminStepState();
}

class _DeviceAdminStepState extends State<DeviceAdminStep>
    with WidgetsBindingObserver {
  final DeviceAdminChannel _admin = DeviceAdminChannel();
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
    final active = await _admin.isActive();
    if (!mounted) return;
    if (active) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Защита от удаления включена ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Защита пока не активна. Если это Xiaomi / Redmi / POCO — сначала '
            'нажмите «Разрешить ограниченные настройки», затем повторите.',
          ),
          duration: Duration(seconds: 5),
        ),
      );
    }
  }

  Future<void> _activate(BuildContext context) async {
    if (await _admin.isActive()) {
      _goNext();
      return;
    }
    _waitingForReturn = true;
    try {
      await _admin.requestActivation();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть диалог: ${e.message}')),
      );
    }
  }

  Future<void> _openRestrictedHelp(BuildContext context) async {
    _waitingForReturn = true;
    try {
      await _admin.openAppDetailsSettings();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть карточку: ${e.message}')),
      );
    }
  }

  void _goNext() {
    if (mounted) context.go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Защита от удаления',
      description:
          'Чтобы ребёнок не мог удалить приложение и остаться без присмотра — '
          'дайте приложению роль администратора устройства. Тогда обычное '
          'удаление будет заблокировано.\n\n'
          'Нажмите «Включить защиту» и в системном окне подтвердите '
          '«Разрешить управлять устройством».\n\n'
          'На Xiaomi / Redmi / POCO (HyperOS) сначала нажмите кнопку '
          '«Разрешить ограниченные настройки» ниже: откроется карточка '
          'приложения, нажмите ⋮ в правом верхнем углу и выберите «Разрешить '
          'ограниченные настройки». После этого вернитесь и включите защиту.',
      parentHint:
          'Настраивает взрослый. Отключить защиту можно в любой момент из '
          'кабинета родителя.',
      actionLabel: 'Включить защиту',
      onRequest: () => _activate(context),
      onSkip: _goNext,
      footer: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: OutlinedButton(
          onPressed: () => _openRestrictedHelp(context),
          child: const Padding(
            padding: EdgeInsets.all(10),
            child: Text('Разрешить ограниченные настройки (Xiaomi)'),
          ),
        ),
      ),
    );
  }
}
