import 'package:flutter/material.dart';

import '../../children/child_models.dart';

/// Карточка статуса ребёнка для bottom-sheet'а на `ChildDetailScreen`.
///
/// Видна и в свернутом, и в развёрнутом состоянии. Содержит:
///   - Avatar (буква имени) + имя + «Был тут N мин назад»
///   - Сетку 4×1 метрик: 🔋батарея / 🎯точность / 📶связь / 📡источник
///   - Footer с описанием качества точности
///
/// Порт из `apps/web/components/locations/child-status-card.tsx`.
class ChildStatusCard extends StatelessWidget {
  const ChildStatusCard({
    super.key,
    required this.childName,
    required this.latest,
  });

  final String childName;
  final ChildLocation? latest;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l = latest;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: avatar + имя + время
          Row(
            children: [
              _Avatar(name: childName),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      childName,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      l == null
                          ? 'Точек ещё нет'
                          : 'Был тут ${_formatAge(l.age)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Метрики 4×1
          if (l != null)
            Row(
              children: [
                Expanded(
                  child: _Metric(
                    icon: l.isCharging == true ? '🔌' : '🔋',
                    badge: l.isCharging == true ? '⚡' : null,
                    label: l.isCharging == true ? 'заряжается' : 'батарея',
                    value: l.batteryLevel != null ? '${l.batteryLevel}%' : '—',
                    valueColor: _batteryColor(l.batteryLevel, l.isCharging),
                  ),
                ),
                Expanded(
                  child: _Metric(
                    icon: '🎯',
                    label: 'точность',
                    value: l.accuracy != null
                        ? '±${l.accuracy!.round()} м'
                        : '—',
                  ),
                ),
                Expanded(
                  child: _Metric(
                    icon: _networkIcon(l.networkType),
                    label: 'связь',
                    value: _networkValue(l),
                  ),
                ),
                Expanded(
                  child: _Metric(
                    icon: '📡',
                    label: 'источник',
                    value: _providerLabel(l.provider),
                  ),
                ),
              ],
            ),
          // Footer — описание точности
          if (l != null && l.accuracy != null) ...[
            const SizedBox(height: 8),
            Text(
              'Точность ${_accuracyQuality(l.accuracy!)} (${l.accuracy!.round()} метров)',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _formatAge(Duration d) {
    if (d.inSeconds < 60) return 'сейчас';
    if (d.inMinutes < 60) return '${d.inMinutes} мин назад';
    if (d.inHours < 24) return '${d.inHours} ч назад';
    return '${d.inDays} дн назад';
  }

  static Color? _batteryColor(int? level, bool? charging) {
    if (charging == true) return const Color(0xFF16A34A); // зелёный
    if (level == null) return null;
    if (level <= 20) return const Color(0xFFDC2626); // красный
    if (level <= 40) return const Color(0xFFEA580C); // оранжевый
    return null;
  }

  static String _networkIcon(NetworkType n) {
    switch (n) {
      case NetworkType.wifi:
        return '📶';
      case NetworkType.mobile:
        return '📱';
      case NetworkType.offline:
        return '🚫';
      case NetworkType.unknown:
        return '❓';
    }
  }

  static String _networkValue(ChildLocation l) {
    switch (l.networkType) {
      case NetworkType.wifi:
        final ssid = l.wifiSsid?.trim();
        return (ssid != null && ssid.isNotEmpty) ? ssid : 'Wi-Fi';
      case NetworkType.mobile:
        final op = l.mobileOperator?.trim();
        return (op != null && op.isNotEmpty) ? op : 'мобильн.';
      case NetworkType.offline:
        return 'нет сети';
      case NetworkType.unknown:
        return '—';
    }
  }

  static String _providerLabel(LocationProvider p) {
    switch (p) {
      case LocationProvider.gps:
      case LocationProvider.fused:
        return 'GPS';
      case LocationProvider.network:
        return 'сеть';
      case LocationProvider.unknown:
        return '—';
    }
  }

  static String _accuracyQuality(double m) {
    if (m <= 30) return 'высокая';
    if (m <= 100) return 'средняя';
    return 'низкая';
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final letter = _firstLetter(name);
    final color = _avatarColor(name);
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  static String _firstLetter(String name) {
    final t = name.trim();
    if (t.isEmpty) return '?';
    return t.characters.first.toUpperCase();
  }

  /// Простой стабильный цвет на основе имени — как в web `avatarColor`.
  static Color _avatarColor(String name) {
    if (name.isEmpty) return const Color(0xFF64748B);
    int hash = 0;
    for (final ch in name.codeUnits) {
      hash = (hash * 31 + ch) & 0x7FFFFFFF;
    }
    const palette = <int>[
      0xFF2563EB, // blue
      0xFF7C3AED, // violet
      0xFFDB2777, // pink
      0xFFE11D48, // rose
      0xFFEA580C, // orange
      0xFFCA8A04, // amber
      0xFF16A34A, // green
      0xFF0891B2, // cyan
      0xFF0D9488, // teal
    ];
    return Color(palette[hash % palette.length]);
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
    this.badge,
  });

  final String icon;
  final String label;
  final String value;
  final Color? valueColor;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Иконка + опциональный badge (молния для зарядки)
        Stack(
          clipBehavior: Clip.none,
          children: [
            Text(icon, style: const TextStyle(fontSize: 18)),
            if (badge != null)
              Positioned(
                right: -8,
                top: -2,
                child: Text(badge!, style: const TextStyle(fontSize: 10)),
              ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
            color: valueColor,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontSize: 10,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }
}
