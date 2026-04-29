import 'package:flutter/material.dart';

import '../../children/child_models.dart';

/// Карточка статуса ребёнка для bottom-sheet'а на `ChildDetailScreen`.
///
/// Видна и в свернутом, и в развёрнутом состоянии. Содержит:
///   - Avatar (буква имени) + имя
///   - Подзаголовок «Был тут N мин назад»
///   - Inline-строка с метриками: 🔋батарея · 🎯точность · 📶связь
///
/// Источник GPS (📡) НЕ выводится — он почти всегда «GPS» и не несёт
/// полезной для родителя информации (Артем в обсуждении 2026-04-29).
///
/// Порт из `apps/web/components/locations/child-status-card.tsx`,
/// упрощённый для мобильного экрана.
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
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          _Avatar(name: childName),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Имя
                Text(
                  childName,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                // Подзаголовок «Был тут N назад»
                Text(
                  l == null ? 'Точек ещё нет' : 'Был тут ${_formatAge(l.age)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (l != null) ...[
                  const SizedBox(height: 4),
                  // Inline-метрики: батарея · точность · связь
                  _InlineMetrics(latest: l),
                ],
              ],
            ),
          ),
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
}

/// Однострочная сводка метрик: 🔋80% · 🎯±4м · 📶MegaFon.
///
/// Каждая метрика — компактный chip без обводки, разделители — тонкие
/// `· ` между значениями. Если значения нет — пропускаем chip,
/// разделители подстраиваются.
class _InlineMetrics extends StatelessWidget {
  const _InlineMetrics({required this.latest});

  final ChildLocation latest;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    final chips = <Widget>[];
    final l = latest;

    // 🔋 Батарея
    if (l.batteryLevel != null) {
      chips.add(_chip(
        icon: l.isCharging == true ? '🔌' : '🔋',
        text: '${l.batteryLevel}%',
        color: _batteryColor(l.batteryLevel, l.isCharging) ??
            theme.colorScheme.onSurface,
      ));
    }

    // 🎯 Точность
    if (l.accuracy != null) {
      chips.add(_chip(
        icon: '🎯',
        text: '±${l.accuracy!.round()} м',
        color: theme.colorScheme.onSurface,
      ));
    }

    // 📶 / 📱 Сеть
    final networkText = _networkText(l);
    if (networkText != null) {
      chips.add(_chip(
        icon: _networkIcon(l.networkType),
        text: networkText,
        color: theme.colorScheme.onSurface,
      ));
    }

    if (chips.isEmpty) return const SizedBox.shrink();

    // Раскладываем chips через разделитель ` · `
    final rowChildren = <Widget>[];
    for (var i = 0; i < chips.length; i++) {
      if (i > 0) {
        rowChildren.add(Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Text('·', style: TextStyle(color: muted, fontSize: 12)),
        ));
      }
      rowChildren.add(chips[i]);
    }

    return DefaultTextStyle.merge(
      style: theme.textTheme.bodySmall ?? const TextStyle(fontSize: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: rowChildren,
      ),
    );
  }

  Widget _chip({
    required String icon,
    required String text,
    required Color color,
  }) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(icon, style: const TextStyle(fontSize: 13, height: 1.0)),
        const SizedBox(width: 3),
        Text(
          text,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.w500,
            fontSize: 12,
          ),
        ),
      ],
    );
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

  static String? _networkText(ChildLocation l) {
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
        return null; // не показывать вообще, чтобы не загромождать
    }
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
