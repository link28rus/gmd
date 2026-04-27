import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/native/app_control_channel.dart';
import 'permissions_wizard.dart';

/// v0.38 Phase 6.1 — onboarding шаг для grant'а PACKAGE_USAGE_STATS.
///
/// Permission special access: системный диалог нет, открываем
/// Settings → Special access → Usage data, пользователь грантит вручную.
/// При возврате (lifecycle resume) проверяем `hasUsageStatsPermission` и:
///   - granted → запускаем UsageStats + InstalledApps workers (one-time +
///     periodic), переходим на /home;
///   - denied → snack «Можно включить позже из Настроек», переходим на /home
///     не блокируя.
///
/// Без permission — статистика на устройстве не собирается, родитель в
/// кабинете видит «нет данных, попроси ребёнка включить разрешение».
class UsageStatsStep extends StatefulWidget {
  const UsageStatsStep({super.key});

  @override
  State<UsageStatsStep> createState() => _UsageStatsStepState();
}

class _UsageStatsStepState extends State<UsageStatsStep>
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
    // Когда пользователь возвращается из системных Settings → проверяем
    // permission. Если granted — двигаемся дальше + запускаем worker.
    if (state == AppLifecycleState.resumed && _waitingForReturn) {
      _waitingForReturn = false;
      unawaited(_checkAfterReturn());
    }
  }

  Future<void> _checkAfterReturn() async {
    final granted = await AppControlChannel.hasUsageStatsPermission();
    if (!mounted) return;
    if (granted) {
      // Запускаем worker'ы немедленно — backfill 7 дней + snapshot apps.
      try {
        await AppControlChannel.scheduleAll();
        await AppControlChannel.runUsageNow();
        await AppControlChannel.runInstalledAppsNow();
      } on PlatformException {
        // Если что-то не так — workers всё равно запустятся через MainActivity
        // .onCreate в следующий раз. Не блокируем UX.
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Доступ к статистике включён ✓'),
          duration: Duration(seconds: 2),
        ),
      );
      _goNext();
    } else {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Доступ не предоставлен. Можно включить позже в Настройках → '
            'Особые разрешения → «Доступ к данным об использовании».',
          ),
          duration: Duration(seconds: 4),
        ),
      );
      _goNext();
    }
  }

  Future<void> _request(BuildContext context) async {
    // Если уже granted — не открываем Settings, сразу пропускаем.
    final granted = await AppControlChannel.hasUsageStatsPermission();
    if (!context.mounted) return;
    if (granted) {
      try {
        await AppControlChannel.scheduleAll();
        await AppControlChannel.runUsageNow();
        await AppControlChannel.runInstalledAppsNow();
      } on PlatformException {
        // ignore
      }
      _goNext();
      return;
    }
    _waitingForReturn = true;
    try {
      await AppControlChannel.openUsageStatsSettings();
    } on PlatformException catch (e) {
      _waitingForReturn = false;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось открыть настройки: ${e.message}')),
      );
    }
  }

  void _goNext() {
    if (mounted) GoRouter.of(context).go('/permissions/accessibility');
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: 6,
      totalSteps: 9,
      title: 'Статистика приложений',
      description:
          'Чтобы родитель видел в кабинете, сколько ты сегодня провёл в '
          'TikTok, играх и других приложениях, и мог при необходимости '
          'заблокировать на время — нужно дать доступ к данным об '
          'использовании.\n\n'
          'Откроется системный экран «Доступ к данным об использовании». '
          'Найди в списке «gmd_child» и переключи тумблер.\n\n'
          'На Xiaomi / Redmi / POCO (HyperOS) сначала открой карточку '
          'приложения, нажми ⋮ в правом верхнем углу и включи '
          '«Разрешить ограниченные настройки» — без этого тумблер '
          'статистики не активируется.\n\n'
          'Можно пропустить — статистика просто не будет собираться, '
          'остальные функции продолжат работать.',
      onRequest: () => _request(context),
      onSkip: _goNext,
      actionLabel: 'Открыть настройки',
    );
  }
}
