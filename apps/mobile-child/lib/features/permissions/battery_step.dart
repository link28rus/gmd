import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class BatteryPermissionsStep extends StatelessWidget {
  const BatteryPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.ignoreBatteryOptimizations.request();
    if (context.mounted) context.go('/permissions/devadmin');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 2,
      totalSteps: 4,
      title: 'Не засыпать',
      description:
          'Разреши приложению работать в фоне, чтобы оно не отключалось, когда нужно больше всего.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/devadmin'),
    );
  }
}
