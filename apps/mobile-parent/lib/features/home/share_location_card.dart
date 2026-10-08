import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/parent_location/parent_location_controller.dart';
import '../../core/providers.dart';

/// Карточка «Показывать вас семье» на главном экране (v0.70.0). Видна, пока
/// флаг включён, а для фоновой передачи чего-то не хватает. Шаги по порядку:
/// геолокация → «Разрешать всегда» (настройки, перепроверка на возврате) →
/// уведомления → без ограничений батареи. Тот же порядок и приёмы, что в
/// мастере разрешений приложения ребёнка (location_step.dart, battery_step.dart).
///
/// Виджет всегда в дереве (пустой, когда всё выдано): он же перепроверяет
/// разрешения при каждом возврате в приложение — отозванное в настройках
/// разрешение вернёт карточку.
class ShareLocationCard extends ConsumerStatefulWidget {
  const ShareLocationCard({super.key});

  @override
  ConsumerState<ShareLocationCard> createState() => _ShareLocationCardState();
}

enum _Step { location, always, notifications, battery }

class _ShareLocationCardState extends ConsumerState<ShareLocationCard> with WidgetsBindingObserver {
  bool _waitingForReturn = false;
  bool _requesting = false;

  ParentLocationController get _ctl => ref.read(parentLocationProvider.notifier);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (Platform.isAndroid) unawaited(_ctl.refreshPermissions());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || !Platform.isAndroid) return;
    final wasWaiting = _waitingForReturn;
    _waitingForReturn = false;
    unawaited(_afterReturn(wasWaiting));
  }

  Future<void> _afterReturn(bool fromSettings) async {
    // Флаг не узнали при старте (не было сети) — пробуем ещё раз.
    if (ref.read(parentLocationProvider).enabled == null) {
      await _ctl.sync();
    } else {
      await _ctl.onPermissionsChanged();
    }
    if (!fromSettings || !mounted) return;
    final perms = ref.read(parentLocationProvider).perms;
    if (perms.location && !perms.always) {
      _say(
        'Пока выбрано не «Всегда». Откройте «Разрешения → Местоположение» '
        'и выберите «Разрешать всегда».',
        warn: true,
      );
    }
  }

  void _say(String text, {bool warn = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(text),
          duration: Duration(seconds: warn ? 5 : 3),
          backgroundColor: warn ? Colors.orange : null,
        ),
      );
  }

  Future<void> _openSettings() async {
    _waitingForReturn = true;
    await openAppSettings();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_requesting) return;
    setState(() => _requesting = true);
    try {
      await action();
      await _ctl.onPermissionsChanged();
    } finally {
      if (mounted) setState(() => _requesting = false);
    }
  }

  Future<void> _requestLocation() async {
    final status = await Permission.locationWhenInUse.request();
    if (!mounted) return;
    if (status.isPermanentlyDenied) {
      _say('Доступ к местоположению запрещён. Включите его в настройках и вернитесь.');
      await _openSettings();
    } else if (!status.isGranted && !status.isLimited) {
      _say('Без доступа к местоположению семья не увидит, где вы.', warn: true);
    }
  }

  Future<void> _requestAlways() async {
    // На Android 10 — диалог, на 11+ система сама ведёт в настройки.
    final status = await Permission.locationAlways.request();
    if (!mounted || status.isGranted) return;
    _say(
      'Выберите «Разрешать всегда»: Разрешения → Местоположение → '
      '«Разрешать всегда». Затем вернитесь в приложение.',
    );
    await _openSettings();
  }

  Future<void> _requestNotifications() async {
    final status = await Permission.notification.request();
    if (!mounted) return;
    if (status.isPermanentlyDenied) {
      _say('Уведомления выключены. Включите их в настройках и вернитесь.');
      await _openSettings();
    }
  }

  Future<void> _requestBattery() async {
    await Permission.ignoreBatteryOptimizations.request();
  }

  Future<void> _turnOff() async {
    try {
      await _ctl.setSharing(false);
      if (mounted) _say('Семья больше не видит, где вы. Включить — в меню ⋮.');
    } catch (_) {
      if (mounted) _say('Не удалось выключить — проверьте интернет.', warn: true);
    }
  }

  _Step? _nextStep(ParentLocationPermissions p) {
    if (!p.location) return _Step.location;
    if (!p.always) return _Step.always;
    if (!p.notifications) return _Step.notifications;
    if (!p.battery) return _Step.battery;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (!Platform.isAndroid) return const SizedBox.shrink();
    final s = ref.watch(parentLocationProvider);
    if (s.enabled != true || !s.perms.checked) return const SizedBox.shrink();
    final step = _nextStep(s.perms);
    if (step == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (String title, String text, String action, Future<void> Function() run) = switch (step) {
      _Step.location => (
        'Доступ к местоположению',
        'Чтобы семья видела вас на карте, разрешите доступ к местоположению.',
        'Разрешить',
        _requestLocation,
      ),
      _Step.always => (
        '«Разрешать всегда»',
        'Иначе передача остановится после перезагрузки или обновления '
            'телефона. В настройках выберите «Местоположение → Разрешать всегда».',
        'Открыть настройки',
        _requestAlways,
      ),
      _Step.notifications => (
        'Уведомления',
        'Пока семья видит, где вы, в шторке висит уведомление «Семья видит, '
            'где вы» — без него Android не даст работать в фоне.',
        'Разрешить',
        _requestNotifications,
      ),
      _Step.battery => (
        'Работа в фоне',
        'Снимите ограничения батареи, иначе Android усыпит передачу. На '
            'Xiaomi / Redmi / POCO ещё включите «Автозапуск» в настройках приложения.',
        'Разрешить',
        _requestBattery,
      ),
    };
    final stepNo = _Step.values.indexOf(step) + 1;

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      color: scheme.secondaryContainer,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.share_location, color: scheme.onSecondaryContainer),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Показывать вас семье',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: scheme.onSecondaryContainer,
                    ),
                  ),
                ),
                Text(
                  'шаг $stepNo из ${_Step.values.length}',
                  style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSecondaryContainer),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: scheme.onSecondaryContainer,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSecondaryContainer),
            ),
            const SizedBox(height: 4),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 4,
              children: [
                TextButton(
                  onPressed: s.busy ? null : _turnOff,
                  child: const Text('Не показывать меня'),
                ),
                if (step == _Step.battery)
                  TextButton(onPressed: _openSettings, child: const Text('Настройки приложения')),
                FilledButton(onPressed: _requesting ? null : () => _run(run), child: Text(action)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
