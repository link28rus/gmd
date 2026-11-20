import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/native/location_service_channel.dart';
import 'home_status_row.dart';

/// v0.31.2 — chip-индикатор текущего профиля GPS-сервиса на home-экране.
///
/// Показывает два возможных состояния:
///  - 💤 «Экономия» (STILL) — FLP в режиме 5 мин / 50 м, Activity Recognition
///     детектит неподвижность. Когда ребёнок пойдёт — сервис автоматически
///     переключится в ACTIVE (20-60 сек задержка AR-классификатора).
///  - 📡 «Активно» (ACTIVE) — FLP в режиме 10 сек / 20 м, трек live.
///
/// Если профиль UNKNOWN (сервис ещё не стартовал / только что переустановили
/// приложение) — чип скрыт, чтобы не путать ребёнка пустым состоянием.
///
/// Данные берутся через MethodChannel `getCurrentProfile` (читает SharedPreferences,
/// куда native пишет при каждом switchProfile). Poll раз в 3 секунды — избыточно
/// для человеческого восприятия, но даёт почти-мгновенную реакцию на смену.
class LocationProfileIndicator extends ConsumerWidget {
  const LocationProfileIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(_locationProfileProvider);
    return profile.maybeWhen(
      data: (p) => _chip(p),
      orElse: () => const SizedBox.shrink(),
    );
  }

  Widget _chip(LocationProfile p) {
    switch (p) {
      case LocationProfile.still:
        return _buildChip(
          icon: Icons.battery_saver,
          label: 'Экономия',
          tooltip:
              'GPS включается раз в 5 минут. Когда пойдёшь — сам перейдёт в активный режим.',
        );
      case LocationProfile.active:
        return _buildChip(
          icon: Icons.gps_fixed,
          label: 'Активно',
          tooltip: 'GPS запрашивает местоположение каждые 10 секунд.',
        );
      case LocationProfile.unknown:
        return const SizedBox.shrink();
    }
  }

  Widget _buildChip({
    required IconData icon,
    required String label,
    required String tooltip,
  }) {
    return Tooltip(
      message: tooltip,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: HomeColors.iconSurface,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: HomeColors.accent),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                'GPS: $label',
                style: const TextStyle(
                  fontSize: 12,
                  color: HomeColors.accent,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Опрос раз в 3 секунды, пока экран показывает индикатор.
final _locationProfileProvider = StreamProvider.autoDispose<LocationProfile>((
  ref,
) async* {
  final channel = LocationServiceChannel();
  // Первое значение — сразу, без задержки 3с.
  yield await channel.getCurrentProfile();
  yield* Stream.periodic(
    const Duration(seconds: 3),
  ).asyncMap((_) => channel.getCurrentProfile());
});
