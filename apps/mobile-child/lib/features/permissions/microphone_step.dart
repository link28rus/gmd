import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import 'permissions_wizard.dart';

// v0.32.0 — шаг запроса доступа к микрофону в permissions-wizard.
// Нужен для фичи «Звук вокруг ребёнка» (Sound Around): родитель инициирует
// запись окружения с устройства ребёнка через push-команду.
//
// Не является блокером: без разрешения другие фичи (GPS, геозоны, SOS) работают.
// При isPermanentlyDenied — предлагаем открыть настройки и сразу продолжаем.
class MicrophoneStep extends StatelessWidget {
  const MicrophoneStep({super.key});

  Future<void> _request(BuildContext context) async {
    final status = await Permission.microphone.request();
    if (!context.mounted) return;
    if (status.isPermanentlyDenied) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Откройте настройки и разрешите доступ к микрофону вручную',
          ),
        ),
      );
      await openAppSettings();
    }
    // Не блокируем flow независимо от результата:
    // без микрофона «Звук вокруг» просто не работает, всё остальное — активно.
    if (context.mounted) context.go('/permissions/devadmin');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 4,
      totalSteps: 8,
      title: 'Доступ к микрофону',
      description:
          'Нужен для функции «Звук вокруг ребёнка» — родитель сможет в кризисной '
          'ситуации удалённо услышать, что происходит рядом. Доступ запрашивается '
          'только при явном запросе родителя; запись не хранится на сервере.\n\n'
          'На Xiaomi / Redmi / POCO дополнительно открой настройки приложения и включи:\n'
          '• «Разрешить ограниченные настройки» — нужно для работы микрофона в фоне\n'
          '• «Автозапуск» — чтобы функция работала даже после перезагрузки\n'
          '• «Экономия энергии» → «Без ограничений» — микрофон не будет убит при экономии батареи\n\n'
          'На Honor (MagicOS) включи:\n'
          '• «Запуск приложений» → «Ручное управление» → «Автозапуск + Запуск в фоне»\n\n'
          'На Samsung (OneUI) убедись:\n'
          '• В батарейных ограничениях — приложение в списке исключений (без батарейных ограничений)',
      onRequest: () => _request(context),
      onSkip: () => context.go('/permissions/devadmin'),
      actionLabel: 'Разрешить',
    );
  }
}
