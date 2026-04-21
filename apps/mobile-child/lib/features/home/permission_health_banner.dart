import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

/// Красный баннер сверху на home, если критические permissions для фонового
/// трекинга не даны. Показывается и при первом запуске, и после обновлений
/// приложения (когда онбординг уже пройден, но требования могли поменяться —
/// как v0.15.2 с MIUI-инструкцией и WAKE_LOCK).
class PermissionHealthBanner extends StatefulWidget {
  const PermissionHealthBanner({super.key});

  @override
  State<PermissionHealthBanner> createState() => _PermissionHealthBannerState();
}

class _PermissionHealthBannerState extends State<PermissionHealthBanner>
    with WidgetsBindingObserver {
  List<String> _missing = const [];
  Timer? _recheckTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _recheckTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Когда пользователь возвращается из настроек приложения —
    // перепроверяем permissions.
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    final missing = <String>[];
    // Локация «Всегда» — без этого background не работает.
    final locAlways = await Permission.locationAlways.status;
    if (!locAlways.isGranted) missing.add('Местоположение «Всегда»');
    // Battery optimization должен быть отключён.
    final battery = await Permission.ignoreBatteryOptimizations.status;
    if (!battery.isGranted) missing.add('Работа в фоне');
    // Уведомления — Android 13+ требует runtime.
    final notif = await Permission.notification.status;
    if (!notif.isGranted) missing.add('Уведомления');
    if (!mounted) return;
    setState(() => _missing = missing);
  }

  @override
  Widget build(BuildContext context) {
    if (_missing.isEmpty) return const SizedBox.shrink();
    return Material(
      color: Colors.red.shade50,
      child: InkWell(
        onTap: () {
          context.go('/permissions/battery');
        },
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(Icons.warning_amber, color: Colors.red.shade700),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Приложение не будет работать в фоне',
                      style: TextStyle(
                        color: Colors.red.shade900,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Не хватает: ${_missing.join(', ')}. Нажми, чтобы исправить.',
                      style: TextStyle(color: Colors.red.shade800, fontSize: 13),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.red.shade700),
            ],
          ),
        ),
      ),
    );
  }
}
