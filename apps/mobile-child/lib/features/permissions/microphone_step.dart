import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import 'permissions_wizard.dart';

/// v0.41.0 — шаг запроса RECORD_AUDIO в permissions-wizard.
///
/// **Изменилось от v0.32:** раньше шаг молча пропускал юзера дальше независимо
/// от результата. Это приводило к тому, что родитель устанавливал app, нажимал
/// «Запретить» в системном диалоге, и потом «Звук вокруг» в кабинете висел
/// бесконечно на «Устанавливаем соединение» (FGS-microphone падает с
/// SecurityException). Теперь:
///   - status.isGranted → переходим дальше
///   - status.isPermanentlyDenied → openAppSettings + остаёмся на шаге,
///     ждём lifecycle resume и перепроверяем
///   - status.isDenied (отказали обычным образом) → показываем warning и
///     остаёмся, кнопка «Разрешить» переспросит системный диалог
///   - кнопка «Пропустить» переименована в «Я не разрешу» с явным предупреждением
///     что фича «Звук вокруг» работать не будет
class MicrophoneStep extends StatefulWidget {
  const MicrophoneStep({super.key});

  @override
  State<MicrophoneStep> createState() => _MicrophoneStepState();
}

class _MicrophoneStepState extends State<MicrophoneStep>
    with WidgetsBindingObserver {
  bool _waitingForReturn = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _waitingForReturn) {
      _waitingForReturn = false;
      _checkAfterReturn();
    }
  }

  Future<void> _checkAfterReturn() async {
    final status = await Permission.microphone.status;
    if (!mounted) return;
    if (status.isGranted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Микрофон разрешён ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Микрофон всё ещё не разрешён. Без него родители не смогут '
            'проверить, всё ли вокруг тебя в порядке.',
          ),
          duration: Duration(seconds: 4),
          backgroundColor: Colors.orange,
        ),
      );
    }
  }

  Future<void> _request(BuildContext context) async {
    final status = await Permission.microphone.request();
    if (!context.mounted) return;
    if (status.isGranted) {
      _goNext();
      return;
    }
    if (status.isPermanentlyDenied) {
      // Системный диалог запроса permission больше не покажется (Android помнит
      // что юзер нажал "Don't ask again"). Открываем Settings — там можно
      // вручную включить.
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Открой Настройки → Разрешения → Микрофон и включи доступ. '
            'После этого вернись — я перепроверю.',
          ),
          duration: Duration(seconds: 5),
        ),
      );
      _waitingForReturn = true;
      await openAppSettings();
      return;
    }
    // Обычный isDenied — system dialog показался, юзер нажал "Запретить",
    // но не permanent. Можно переспросить.
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Без микрофона «Звук вокруг» не будет работать. Нажми «Разрешить» ещё раз.',
        ),
        duration: Duration(seconds: 4),
        backgroundColor: Colors.orange,
      ),
    );
  }

  Future<void> _confirmSkip(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отказаться от микрофона?'),
        content: const Text(
          'Если ты не разрешишь микрофон — родители НЕ смогут удалённо проверить '
          'звук вокруг тебя в случае беспокойства. Включить можно потом в '
          'настройках телефона.\n\nТочно отказываешься?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Назад'),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Да, отказаться'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) _goNext();
  }

  void _goNext() {
    if (mounted) GoRouter.of(context).go('/permissions/devadmin');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 4,
      totalSteps: 9,
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
      onSkip: () => _confirmSkip(context),
      actionLabel: 'Разрешить',
    );
  }
}
