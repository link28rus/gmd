import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/native/app_control_channel.dart';
import '../../core/native/device_admin_channel.dart';
import '../../core/updates/app_update_channel.dart';
import '../../core/version/app_version.dart';
import 'wizard_steps.dart';

/// Итоговый экран мастера: чек-лист выданных и невыданных разрешений.
///
/// Заменяет ситуацию «9 шагов кончились — ты сразу на home, и не понятно, что
/// включилось, а что нет». Показывает состояние каждого разрешения; по тапу на
/// невыданный пункт можно вернуться к нужному шагу и до-настроить.
class WizardSummaryScreen extends StatefulWidget {
  const WizardSummaryScreen({super.key});

  @override
  State<WizardSummaryScreen> createState() => _WizardSummaryScreenState();
}

class _SummaryItem {
  _SummaryItem({
    required this.title,
    required this.importance,
    required this.route,
    required this.granted,
  });

  final String title;
  final StepImportance importance;
  final String route;
  final bool granted;
}

class _WizardSummaryScreenState extends State<WizardSummaryScreen>
    with WidgetsBindingObserver {
  final DeviceAdminChannel _admin = DeviceAdminChannel();
  List<_SummaryItem>? _items;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_check());
  }

  Future<void> _check() async {
    final notif = await Permission.notification.status;
    final locAlways = await Permission.locationAlways.status;
    final battery = await Permission.ignoreBatteryOptimizations.status;
    final mic = await Permission.microphone.status;
    final activity = await Permission.activityRecognition.status;
    final admin = await _admin.isActive();
    final a11y = await AppControlChannel.isAccessibilityServiceEnabled();
    final overlay = await AppControlChannel.canDrawOverlays();
    final usage = await AppControlChannel.hasUsageStatsPermission();
    final updates = await AppUpdateChannel.canRequestInstall();

    final items = <_SummaryItem>[
      _SummaryItem(
        title: 'Уведомления',
        importance: StepImportance.mandatory,
        route: '/permissions/notifications',
        granted: notif.isGranted,
      ),
      _SummaryItem(
        title: 'Местоположение «Всегда»',
        importance: StepImportance.mandatory,
        route: '/permissions/location',
        granted: locAlways.isGranted,
      ),
      _SummaryItem(
        title: 'Работа в фоне',
        importance: StepImportance.mandatory,
        route: '/permissions/battery',
        granted: battery.isGranted,
      ),
      _SummaryItem(
        title: 'Защита от удаления',
        importance: StepImportance.recommended,
        route: '/permissions/devadmin',
        granted: admin,
      ),
      _SummaryItem(
        title: 'Блокировка приложений',
        importance: StepImportance.recommended,
        route: '/permissions/accessibility',
        granted: a11y,
      ),
      _SummaryItem(
        title: 'Экран блокировки',
        importance: StepImportance.recommended,
        route: '/permissions/overlay',
        granted: overlay,
      ),
      _SummaryItem(
        title: 'Статистика приложений',
        importance: StepImportance.recommended,
        route: '/permissions/usage-stats',
        granted: usage,
      ),
      _SummaryItem(
        title: 'Звук вокруг ребёнка',
        importance: StepImportance.recommended,
        route: '/permissions/microphone',
        granted: mic.isGranted,
      ),
      _SummaryItem(
        title: 'Обновления приложения',
        importance: StepImportance.recommended,
        route: '/permissions/updates',
        granted: updates,
      ),
      _SummaryItem(
        title: 'Экономия батареи',
        importance: StepImportance.optional,
        route: '/permissions/activity',
        granted: activity.isGranted,
      ),
    ];
    if (!mounted) return;
    setState(() => _items = items);
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final allMandatoryOk = items == null
        ? true
        : items
            .where((i) => i.importance == StepImportance.mandatory)
            .every((i) => i.granted);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Готово'),
        automaticallyImplyLeading: false,
        actions: const [
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 12),
            child: AppVersionLabel(),
          ),
        ],
      ),
      body: items == null
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Header(allMandatoryOk: allMandatoryOk),
                  const SizedBox(height: 20),
                  for (final item in items) _ItemRow(item: item, onTap: () {
                    if (!item.granted) context.go(item.route);
                  }),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: () => context.go('/home'),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(
                        allMandatoryOk
                            ? 'Всё готово — передать телефон ребёнку'
                            : 'Всё равно продолжить',
                        style: const TextStyle(fontSize: 16),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Незавершённые пункты можно настроить позже — приложение '
                    'напомнит о них на главном экране.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: Colors.black54),
                  ),
                ],
              ),
            ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.allMandatoryOk});

  final bool allMandatoryOk;

  @override
  Widget build(BuildContext context) {
    final color = allMandatoryOk ? Colors.green : Colors.orange;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            allMandatoryOk ? Icons.check_circle : Icons.warning_amber,
            color: color.shade700,
            size: 32,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              allMandatoryOk
                  ? 'Главное настроено. Приложение готово к работе.'
                  : 'Не хватает обязательных разрешений — без них родитель '
                      'может не увидеть ребёнка. Нажмите на них, чтобы исправить.',
              style: TextStyle(
                fontSize: 15,
                height: 1.35,
                color: color.shade900,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({required this.item, required this.onTap});

  final _SummaryItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: item.granted ? null : onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Icon(
              item.granted ? Icons.check_circle : Icons.radio_button_unchecked,
              color: item.granted ? Colors.green : item.importance.color,
              size: 24,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(fontSize: 15),
                  ),
                  Text(
                    item.granted ? 'Включено' : item.importance.label,
                    style: TextStyle(
                      fontSize: 12,
                      color: item.granted
                          ? Colors.green.shade700
                          : item.importance.color,
                    ),
                  ),
                ],
              ),
            ),
            if (!item.granted)
              const Icon(Icons.chevron_right, color: Colors.black38),
          ],
        ),
      ),
    );
  }
}
