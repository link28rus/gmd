import 'package:flutter/material.dart';

/// Заряд батареи на общей карте семьи (v0.86.0): значок и цвет по уровню.
/// Пороги — как на карточке состояния ребёнка (`child_status_card.dart`).

/// Цвет заряда: зелёный при зарядке, красный ≤ 20 %, оранжевый ≤ 40 %,
/// иначе null (цвет текста по умолчанию).
Color? batteryColor(int? level, bool? charging) {
  if (charging == true) return const Color(0xFF16A34A);
  if (level == null) return null;
  if (level <= 20) return const Color(0xFFDC2626);
  if (level <= 40) return const Color(0xFFEA580C);
  return null;
}

IconData batteryIcon(int level, bool? charging) {
  if (charging == true) return Icons.battery_charging_full;
  if (level <= 10) return Icons.battery_alert;
  if (level >= 95) return Icons.battery_full;
  const bars = [
    Icons.battery_0_bar,
    Icons.battery_1_bar,
    Icons.battery_2_bar,
    Icons.battery_3_bar,
    Icons.battery_4_bar,
    Icons.battery_5_bar,
    Icons.battery_6_bar,
  ];
  return bars[(level / 100 * 6).round().clamp(0, 6)];
}

/// «🔋 64%». Ничего не рисует, когда заряд неизвестен.
class BatteryBadge extends StatelessWidget {
  const BatteryBadge({
    super.key,
    required this.level,
    this.charging,
    this.fontSize = 12,
    this.color,
  });

  final int? level;
  final bool? charging;
  final double fontSize;

  /// Цвет при нормальном заряде (по умолчанию — onSurfaceVariant).
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final l = level;
    if (l == null) return const SizedBox.shrink();
    final c = batteryColor(l, charging) ??
        color ??
        Theme.of(context).colorScheme.onSurfaceVariant;
    return Semantics(
      label: charging == true ? 'Заряд $l %, заряжается' : 'Заряд $l %',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(batteryIcon(l, charging), size: fontSize + 2, color: c),
          Text(
            '$l%',
            style: TextStyle(fontSize: fontSize, height: 1.2, color: c),
          ),
        ],
      ),
    );
  }
}
