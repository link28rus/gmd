import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/location';

/// Ключевой шаг: доступ к местоположению в режиме «Разрешать всегда».
///
/// На Android 11+ система НЕ выдаёт background-локацию из обычного диалога —
/// сначала грантится «При использовании приложения», а «Всегда» пользователь
/// выбирает вручную в системных настройках. Поэтому здесь:
///   1. запрашиваем `locationWhenInUse` (обычный диалог);
///   2. если foreground-доступ есть, но «Всегда» ещё нет — открываем настройки
///      приложения и ждём возврата (lifecycle resume), затем перепроверяем;
///   3. только когда `locationAlways` реально granted — идём дальше.
///
/// Раньше шаг делал `whenInUse.request()` → `always.request()` → сразу next,
/// из-за чего «Всегда» тихо не выдавалось, а background-трекинг не работал.
class LocationPermissionsStep extends StatefulWidget {
  const LocationPermissionsStep({super.key});

  @override
  State<LocationPermissionsStep> createState() =>
      _LocationPermissionsStepState();
}

class _LocationPermissionsStepState extends State<LocationPermissionsStep>
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
    final always = await Permission.locationAlways.status;
    if (!mounted) return;
    if (always.isGranted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Доступ «Всегда» включён ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Пока выбрано не «Всегда». Откройте «Разрешения → Местоположение» '
            'и выберите «Разрешать всегда».',
          ),
          duration: Duration(seconds: 5),
          backgroundColor: Colors.orange,
        ),
      );
    }
  }

  Future<void> _request(BuildContext context) async {
    // Уже всё выдано — не беспокоим пользователя.
    if (await Permission.locationAlways.status.isGranted) {
      _goNext();
      return;
    }

    final whenInUse = await Permission.locationWhenInUse.request();
    if (!context.mounted) return;

    if (whenInUse.isPermanentlyDenied) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Доступ к местоположению отключён. Откройте настройки и включите '
            'его вручную, затем вернитесь.',
          ),
          duration: Duration(seconds: 5),
        ),
      );
      _waitingForReturn = true;
      await openAppSettings();
      return;
    }

    if (!whenInUse.isGranted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Без доступа к местоположению родитель не увидит, где ребёнок. '
            'Нажмите «Разрешить» ещё раз.',
          ),
          duration: Duration(seconds: 4),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    // Foreground выдан. Пробуем получить «Всегда»: на Android 10 покажется
    // диалог, на 11+ — permission_handler откроет настройки приложения.
    final always = await Permission.locationAlways.request();
    if (!context.mounted) return;
    if (always.isGranted) {
      _goNext();
      return;
    }

    // «Всегда» из диалога не пришло (типично для Android 11+): ведём в настройки
    // и перепроверяем на возврате.
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Теперь выберите «Разрешать всегда»: Разрешения → Местоположение → '
          '«Разрешать всегда». После этого вернитесь в приложение.',
        ),
        duration: Duration(seconds: 6),
      ),
    );
    _waitingForReturn = true;
    await openAppSettings();
  }

  void _goNext() {
    if (mounted) context.go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Местоположение',
      description:
          'Это главная функция: показывать родителю, где находится ребёнок. '
          'Нужен доступ «Разрешать всегда» — иначе местоположение перестанет '
          'обновляться, как только экран заблокируется.\n\n'
          'На Android 11 и новее система сначала предложит «При использовании '
          'приложения». Выберите его, затем на открывшемся экране настроек '
          'переключите на «Разрешать всегда».',
      parentHint:
          'Настраивает взрослый: важно выбрать именно «Разрешать всегда», а не '
          '«Только при использовании».',
      actionLabel: 'Разрешить местоположение',
      onRequest: () => _request(context),
      onSkip: _goNext,
    );
  }
}
