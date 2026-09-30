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
  String _route = '/permissions/battery';
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
    var route = '/permissions/battery';
    // Локация «Всегда» — без этого background не работает.
    final locAlways = await Permission.locationAlways.status;
    if (!locAlways.isGranted) missing.add('Местоположение «Всегда»');
    // Battery optimization должен быть отключён.
    final battery = await Permission.ignoreBatteryOptimizations.status;
    if (!battery.isGranted) missing.add('Работа в фоне');
    // Уведомления — Android 13+ требует runtime.
    final notif = await Permission.notification.status;
    if (!notif.isGranted) missing.add('Уведомления');
    // v0.41.0: микрофон для «Звук вокруг ребёнка». Без RECORD_AUDIO
    // FGS-microphone падает с SecurityException, кнопка в кабинете родителя
    // вечно висит на «Устанавливаем соединение». Раньше об этом нельзя было
    // узнать — теперь баннер на home сразу подсвечивает проблему.
    final mic = await Permission.microphone.status;
    if (!mic.isGranted) {
      missing.add('Микрофон');
      if (missing.length == 1) route = '/permissions/microphone';
    }
    // v0.68.0: «поверх других приложений» — без него «Звук вокруг» не поднимется
    // сам после перезагрузки телефона (авто-запуск MicWakeActivity невозможен).
    final overlay = await Permission.systemAlertWindow.status;
    if (!overlay.isGranted) {
      missing.add('Звук вокруг после перезагрузки');
      if (missing.length == 1) route = '/permissions/overlay';
    }
    if (!mounted) return;
    setState(() {
      _missing = missing;
      _route = route;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_missing.isEmpty) return const SizedBox.shrink();
    return Material(
      color: Colors.red.shade50,
      child: InkWell(
        onTap: () {
          context.go(_route);
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
                      'Не все разрешения настроены',
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
