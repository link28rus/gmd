import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';
import 'wizard_steps.dart';

const _route = '/permissions/activity';

// v0.31.0 — опциональное разрешение Activity Recognition (Android 10+).
// Используется LocationForegroundService: когда Google Play Services
// детектит STILL-состояние, сервис переключает FLP с интервала 10с на 5мин.
// Это экономит батарею ребёнка примерно на 30-40% при стоянке.
//
// Без разрешения приложение работает, accuracy-gate всё равно отфильтровывает
// indoor-шум — просто интервал постоянно 10с (как раньше).
class ActivityRecognitionStep extends StatelessWidget {
  const ActivityRecognitionStep({super.key});

  Future<void> _request(BuildContext context) async {
    await Permission.activityRecognition.request();
    if (context.mounted) context.go(wizardNextRoute(_route));
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      route: _route,
      title: 'Экономия батареи',
      description:
          'Разрешите распознавание физической активности (идёт / едет / стоит) — '
          'тогда приложение реже включает GPS, когда ребёнок не двигается, и '
          'телефон дольше держит заряд.\n\n'
          'Это последний шаг и его можно пропустить: всё будет работать, просто '
          'батарея сядет чуть быстрее.',
      onRequest: () => _request(context),
      onSkip: () => context.go(wizardNextRoute(_route)),
    );
  }
}
