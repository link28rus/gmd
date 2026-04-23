import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'permissions_wizard.dart';

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
    if (context.mounted) context.go('/permissions/devadmin');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 3,
      totalSteps: 5,
      title: 'Экономия батареи',
      description:
          'Разреши распознавание физической активности (сидишь / идёшь / едешь), '
          'чтобы приложение реже включало GPS, когда ты не двигаешься. '
          'Телефон будет дольше держать заряд.\n\n'
          'Можно пропустить — всё будет работать, но чуть быстрее сядет батарея.',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/devadmin'),
    );
  }
}
