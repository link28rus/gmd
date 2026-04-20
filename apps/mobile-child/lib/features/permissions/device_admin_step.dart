import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/native/device_admin_channel.dart';
import 'permissions_wizard.dart';

class DeviceAdminPermissionsStep extends StatelessWidget {
  const DeviceAdminPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await DeviceAdminChannel().request();
    if (context.mounted) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 3,
      totalSteps: 4,
      title: 'Защита от удаления',
      description: 'Попросим маму/папу подтвердить, если ты захочешь удалить приложение. Это на случай, если телефон попадёт в чужие руки.',
      actionLabel: 'Включить защиту',
      onRequest: () => _request(context),
      onSkip: () => context.go('/home'),
    );
  }
}
