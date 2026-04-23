import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class BatteryPermissionsStep extends StatelessWidget {
  const BatteryPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.ignoreBatteryOptimizations.request();
    if (context.mounted) context.go('/permissions/activity');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 2,
      totalSteps: 6,
      title: 'Не засыпать',
      description:
          'Разреши приложению работать в фоне, чтобы мама и папа видели где ты даже при '
          'заблокированном экране.\n\n'
          'На Xiaomi / Redmi / POCO дополнительно открой настройки приложения ('
          'кнопка ниже) и включи:\n'
          '• «Автозапуск»\n'
          '• «Контроль активности» → «Нет ограничений»\n'
          '• «Экономия энергии» → «Без ограничений»',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/activity'),
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
