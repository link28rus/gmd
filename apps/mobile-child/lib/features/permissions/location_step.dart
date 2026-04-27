import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class LocationPermissionsStep extends StatelessWidget {
  const LocationPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    final whenInUse = await Permission.locationWhenInUse.request();
    if (whenInUse.isGranted) {
      await Permission.locationAlways.request();
    }
    if (context.mounted) context.go('/permissions/battery');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 1,
      totalSteps: 9,
      title: 'Местоположение',
      description:
          'Чтобы видеть где ты, даже когда приложение закрыто. Нужно «Всегда» — это защищает тебя.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/battery'),
    );
  }
}
