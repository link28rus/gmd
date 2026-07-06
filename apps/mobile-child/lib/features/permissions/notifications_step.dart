import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/notifications';

class NotificationsPermissionsStep extends StatelessWidget {
  const NotificationsPermissionsStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.notification.request();
    if (context.mounted) context.go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Уведомления',
      description:
          'Приложение показывает постоянное уведомление о том, что геолокация '
          'работает, и присылает тревожные сигналы — SOS от ребёнка, вход и '
          'выход из геозон. Без этого разрешения Android будет скрывать работу '
          'приложения, и важные сигналы могут не дойти.',
      onRequest: () => _request(context),
      onSkip: () => context.go(wizardNextRoute(_route)),
    );
  }
}
