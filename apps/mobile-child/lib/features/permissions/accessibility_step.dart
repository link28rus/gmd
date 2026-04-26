import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/native/app_control_channel.dart';
import 'permissions_wizard.dart';

/// v0.39 Phase 6.2 — onboarding шаг для гранта Accessibility (блокировка приложений).
///
/// Без AccessibilityService [GmdAccessibilityService] не может ловить
/// `TYPE_WINDOW_STATE_CHANGED` → не может определить, какое приложение открыл
/// ребёнок → не может показать [BlockOverlayActivity]. Блокировка просто не работает.
///
/// Permission special access: системного диалога нет, открываем
/// Settings → Accessibility, пользователь грантит вручную.
///
/// На MIUI/HyperOS перед грантом Accessibility нужно ещё «Разрешить ограниченные
/// настройки» в карточке приложения — поэтому добавлена отдельная кнопка
/// «Разрешить ограниченные настройки» (Xiaomi/Redmi/POCO only flow).
///
/// При возврате (lifecycle resume) проверяем `isAccessibilityServiceEnabled` и:
///   - granted → snack «Блокировка приложений включена ✓», переходим на /home;
///   - denied → snack «Можно включить позже из Настроек», переходим на /home
///     не блокируя.
class AccessibilityStep extends StatefulWidget {
  const AccessibilityStep({super.key});

  @override
  State<AccessibilityStep> createState() => _AccessibilityStepState();
}

class _AccessibilityStepState extends State<AccessibilityStep>
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
      unawaited(_checkAfterReturn());
    }
  }

  Future<void> _checkAfterReturn() async {
    final granted = await AppControlChannel.isAccessibilityServiceEnabled();
    if (!mounted) return;
    if (granted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Блокировка приложений включена ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Не удалось включить. Если ты на Xiaomi — сначала открой '
            'карточку приложения и разреши «Ограниченные настройки», '
            'затем повтори.',
          ),
          duration: Duration(seconds: 5),
        ),
      );
      // Не уходим автоматически — пусть пользователь повторит/откроет restricted-settings.
    }
  }

  Future<void> _openAccessibility(BuildContext context) async {
    final granted = await AppControlChannel.isAccessibilityServiceEnabled();
    if (!context.mounted) return;
    if (granted) {
      _goNext();
      return;
    }
    _waitingForReturn = true;
    try {
      await AppControlChannel.openAccessibilitySettings();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть настройки: ${e.message}')),
      );
    }
  }

  Future<void> _openRestrictedHelp(BuildContext context) async {
    _waitingForReturn = true;
    try {
      await AppControlChannel.openAppDetailsSettings();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть карточку: ${e.message}')),
      );
    }
  }

  void _goNext() {
    if (mounted) GoRouter.of(context).go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 7,
      totalSteps: 8,
      title: 'Блокировка приложений',
      description:
          'Чтобы родитель мог временно заблокировать игры и соцсети — нужно '
          'дать доступ к спецвозможностям. Сервис только проверяет, какое '
          'приложение открыто, и не читает его содержимое.\n\n'
          'Откроется системный экран «Спецвозможности» (Accessibility). '
          'Найди в списке «Скачанные службы» → «Где мои дети — ребёнок» '
          'и переключи тумблер.\n\n'
          'На Xiaomi / Redmi / POCO (HyperOS) сначала нажми кнопку '
          '«Разрешить ограниченные настройки» ниже — откроется карточка '
          'приложения, нажми ⋮ в правом верхнем углу и выбери «Разрешить '
          'ограниченные настройки». После этого вернись и нажми «Включить '
          'блокировку».',
      onRequest: () => _openAccessibility(context),
      onSkip: _goNext,
      actionLabel: 'Включить блокировку',
      footer: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: OutlinedButton(
          onPressed: () => _openRestrictedHelp(context),
          child: const Padding(
            padding: EdgeInsets.all(10),
            child: Text('Разрешить ограниченные настройки (Xiaomi)'),
          ),
        ),
      ),
    );
  }
}
