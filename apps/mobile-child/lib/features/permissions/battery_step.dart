import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/battery';

class BatteryPermissionsStep extends StatelessWidget {
  const BatteryPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.ignoreBatteryOptimizations.request();
    if (context.mounted) context.go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Работа в фоне',
      description:
          'Разрешите приложению работать в фоне — иначе Android будет усыплять '
          'его, и местоположение перестанет обновляться при заблокированном '
          'экране. Это же нужно для функции «Звук вокруг ребёнка».\n\n'
          'На Xiaomi / Redmi / POCO дополнительно откройте настройки приложения '
          '(кнопка ниже) и включите:\n'
          '• «Автозапуск» — чтобы геолокация запускалась после перезагрузки;\n'
          '• «Контроль активности» → «Нет ограничений»;\n'
          '• «Экономия энергии» → «Без ограничений».',
      parentHint:
          'Нажмите «Разрешить» и подтвердите в системном окне. Настраивает '
          'взрослый.',
      onRequest: () => _request(context),
      onSkip: () => context.go(wizardNextRoute(_route)),
      footer: Center(
        child: TextButton.icon(
          onPressed: openAppSettings,
          icon: const Icon(Icons.settings_outlined, size: 18),
          label: const Text('Открыть настройки приложения'),
        ),
      ),
    );
  }
}
