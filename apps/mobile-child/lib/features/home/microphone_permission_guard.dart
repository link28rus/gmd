import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

/// v0.41.0 — модальный диалог при каждом запуске app, если RECORD_AUDIO denied.
///
/// Дополняет [PermissionHealthBanner] (постоянный visual indicator). Баннер
/// легко проигнорировать; диалог требует осознанного действия.
///
/// Логика:
///   1. На первом frame после mount → проверка [Permission.microphone.status]
///   2. Если denied/permanentlyDenied → [showDialog] с двумя кнопками:
///      «Разрешить» (request или openAppSettings) / «Позже» (закрыть)
///   3. На lifecycle resume (вернулись из Settings) → перепроверка
///   4. Если granted → диалог автоматически dismisses (если открыт)
///
/// Невидимый widget — возвращает `SizedBox.shrink`. Просто триггерит side-effect.
class MicrophonePermissionGuard extends StatefulWidget {
  const MicrophonePermissionGuard({super.key});

  @override
  State<MicrophonePermissionGuard> createState() =>
      _MicrophonePermissionGuardState();
}

class _MicrophonePermissionGuardState extends State<MicrophonePermissionGuard>
    with WidgetsBindingObserver {
  bool _dialogShowing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_checkAndPrompt());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // 1) Если ждали возврата из Settings — перепроверим, granted ли
      // 2) Просто на каждый foreground (возврат с Wi-Fi настроек, других apps)
      //    тоже стоит перепроверить — пользователь мог отозвать permission
      //    из system settings извне
      unawaited(_checkAndPrompt());
    }
  }

  Future<void> _checkAndPrompt() async {
    if (!mounted) return;
    final status = await Permission.microphone.status;
    if (!mounted) return;
    if (status.isGranted) {
      // Если диалог открыт (например, юзер только что разрешил в settings) —
      // закрываем.
      if (_dialogShowing) {
        Navigator.of(context, rootNavigator: true).pop();
        _dialogShowing = false;
      }
      return;
    }
    // Не показываем второй диалог поверх первого.
    if (_dialogShowing) return;
    _dialogShowing = true;
    final result = await showDialog<_MicAction>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        icon: Icon(
          Icons.mic_off_outlined,
          color: Colors.orange.shade700,
          size: 48,
        ),
        title: const Text('Микрофон выключен'),
        content: const Text(
          'Без доступа к микрофону родители не смогут удалённо проверить, '
          'всё ли с тобой в порядке (функция «Звук вокруг»).\n\n'
          'Разреши доступ — это занимает 5 секунд.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(_MicAction.later),
            child: const Text('Позже'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(_MicAction.allow),
            child: const Text('Разрешить'),
          ),
        ],
      ),
    );
    _dialogShowing = false;
    if (!mounted || result != _MicAction.allow) return;
    await _doRequest();
  }

  Future<void> _doRequest() async {
    final current = await Permission.microphone.status;
    if (!mounted) return;
    if (current.isPermanentlyDenied) {
      // Системный диалог больше не покажется — отправляем в Settings.
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Открой Настройки → Разрешения → Микрофон → «Разрешить». '
            'Затем вернись в приложение — я перепроверю.',
          ),
          duration: Duration(seconds: 5),
        ),
      );
      await openAppSettings();
      return;
    }
    final newStatus = await Permission.microphone.request();
    if (!mounted) return;
    if (newStatus.isGranted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Микрофон разрешён ✓'),
          duration: Duration(seconds: 2),
        ),
      );
    } else if (newStatus.isPermanentlyDenied) {
      // Юзер только что нажал "Don't ask again" — отправляем в Settings.
      await openAppSettings();
    }
    // Если просто isDenied — диалог появится снова при следующем lifecycle resume.
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

enum _MicAction { allow, later }
