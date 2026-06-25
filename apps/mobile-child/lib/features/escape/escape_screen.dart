import 'package:flutter/material.dart';

import '../../core/native/escape_channel.dart';

/// v0.38 ESCAPE HATCH UI.
///
/// Показывается когда родитель удалил ребёнка из кабинета (или сделал
/// /reset-device). Native слой уже снял Device Admin, остановил workers и
/// стёр creds — устройство снова можно нормально удалить.
///
/// Экран НЕ блокирует физическое удаление: app можно удалить через
/// Settings → Apps → Перископ Ребёнка → Удалить (кнопка ведёт прямо туда).
class EscapeScreen extends StatefulWidget {
  const EscapeScreen({super.key});

  @override
  State<EscapeScreen> createState() => _EscapeScreenState();
}

class _EscapeScreenState extends State<EscapeScreen> {
  String? _reason;
  bool _retrying = false;

  @override
  void initState() {
    super.initState();
    _loadReason();
  }

  Future<void> _loadReason() async {
    final r = await EscapeChannel.lastReason();
    if (mounted) setState(() => _reason = r);
  }

  Future<void> _retryProbe() async {
    setState(() => _retrying = true);
    try {
      // Если родитель восстановил ребёнка — probe вернёт ACTIVE, но native
      // флаг escape_mode уже выставлен и не снимается обратно (escape — это
      // одностороннее состояние, чтобы не было flicker). Пользователь должен
      // переустановить app для нового claim'а.
      await EscapeChannel.probeNow();
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  String get _title {
    switch (_reason) {
      case 'child_deleted':
        return 'Родитель удалил твой профиль';
      case 'device_revoked':
        return 'Устройство отвязано';
      default:
        return 'Приложение больше не привязано';
    }
  }

  String get _body {
    switch (_reason) {
      case 'child_deleted':
        return 'Профиль ребёнка был удалён в кабинете родителя. '
            'Все ограничения (защита от удаления, блокировки) сняты — '
            'ты можешь удалить приложение, нажав кнопку ниже.';
      case 'device_revoked':
        return 'Родитель отвязал это устройство в кабинете. '
            'Все ограничения сняты. Чтобы пользоваться приложением '
            'заново — переустанови его и попроси родителя выпустить новый QR-код. '
            'Чтобы удалить приложение — нажми кнопку ниже.';
      default:
        return 'Сервер сообщил, что устройство больше не зарегистрировано. '
            'Все защиты сняты, приложение можно удалить.';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 32),
              const Icon(Icons.lock_open, size: 72, color: Colors.green),
              const SizedBox(height: 24),
              Text(
                _title,
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                _body,
                style: const TextStyle(fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const Spacer(),
              FilledButton.icon(
                onPressed: () => EscapeChannel.openAppDetails(),
                icon: const Icon(Icons.settings),
                label: const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('Открыть настройки приложения'),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _retrying ? null : _retryProbe,
                child: Text(_retrying ? 'Проверяем…' : 'Проверить связь с сервером'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
