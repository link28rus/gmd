import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

class NotificationsPermissionsStep extends StatelessWidget {
  const NotificationsPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.notification.request();
    if (context.mounted) context.go('/permissions/location');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 0,
      totalSteps: 8,
      title: 'Уведомления',
      description:
          'Маме/папе нужно знать, если что-то случится. Мы будем показывать уведомления от GMD.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/location'),
    );
  }
}
