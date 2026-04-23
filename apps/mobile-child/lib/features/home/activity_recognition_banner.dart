import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/native/location_service_channel.dart';

/// v0.31.1 — info-баннер для включения разрешения «Физическая активность»
/// у пользователей, которые обновились с 0.30.x/0.31.0 и не проходили
/// онбординг (permission остался denied).
///
/// С этим разрешением LocationForegroundService слушает Activity Recognition
/// API и переключает FLP в STILL-режим (интервал 5 мин вместо 10 сек), когда
/// ребёнок неподвижен. Экономит 30-40% батареи.
///
/// Без разрешения приложение работает — просто интервал GPS постоянный.
/// Поэтому баннер НЕ критический (амбер, не красный), кликабельный; при тапе
/// запрашивает permission и перезапускает сервис, чтобы тот перерегистрировал
/// подписку на transitions.
///
/// На Android < 10 permission_handler возвращает isGranted автоматически,
/// баннер не показывается.
class ActivityRecognitionBanner extends StatefulWidget {
  const ActivityRecognitionBanner({super.key});

  @override
  State<ActivityRecognitionBanner> createState() => _ActivityRecognitionBannerState();
}

class _ActivityRecognitionBannerState extends State<ActivityRecognitionBanner>
    with WidgetsBindingObserver {
  bool _show = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Пользователь мог выдать permission в системных настройках и вернуться —
    // перепроверим статус.
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    final status = await Permission.activityRecognition.status;
    if (!mounted) return;
    // Скрываем баннер если: granted (всё ок) / restricted (iOS parental —
    // пользователь не может изменить).
    final hide = status.isGranted || status.isRestricted;
    setState(() => _show = !hide);
  }

  Future<void> _request() async {
    final status = await Permission.activityRecognition.request();
    diagLog('activity', 'banner request → $status');
    if (status.isGranted) {
      // Сервис был запущен ДО grant'а permission и попытался подписаться на
      // Activity Recognition — получил SecurityException и живёт в active-only.
      // Пере-стартуем: stop → start; при старте снова зарегистрирует transitions,
      // на этот раз успешно (permission теперь granted).
      final channel = LocationServiceChannel();
      try {
        await channel.stopService();
        await channel.startService();
        diagLog('activity', 'banner: service restarted after grant');
      } catch (e) {
        diagLog('activity', 'banner: service restart failed: $e');
      }
    } else if (status.isPermanentlyDenied) {
      // Навсегда отказал — только через настройки. Не открываем автоматически,
      // чтобы не сбить UX; баннер просто останется на экране.
      diagLog('activity', 'banner: permanently denied');
    }
    await _check();
  }

  @override
  Widget build(BuildContext context) {
    if (!_show) return const SizedBox.shrink();
    return Material(
      color: Colors.amber.shade50,
      child: InkWell(
        onTap: _request,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(Icons.battery_saver, color: Colors.amber.shade800),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Включи экономию батареи',
                      style: TextStyle(
                        color: Colors.amber.shade900,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Разреши «Физическую активность» — батарея будет дольше держать, '
                      'когда ты не двигаешься.',
                      style: TextStyle(color: Colors.amber.shade900, fontSize: 13),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.amber.shade800),
            ],
          ),
        ),
      ),
    );
  }
}
