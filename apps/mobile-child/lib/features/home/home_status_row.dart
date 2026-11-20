import 'package:flutter/material.dart';

// Палитра главного экрана и экрана паузы Android.
abstract final class HomeColors {
  static const background = Color(0xFF0A1628);
  static const surface = Color(0xFF14243D);
  static const iconSurface = Color(0xFF213D61);
  static const outline = Color(0xFF536D91);
  static const accent = Color(0xFFC4DDFF);
  static const muted = Color(0xFFB9CAE3);
  static const warning = Color(0xFFFFCF80);
  static const sos = Color(0xFFB42335);
  static const sosSending = Color(0xFF8F2938);
}

class HomeStatusRow extends StatelessWidget {
  const HomeStatusRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.color = HomeColors.accent,
    this.footer,
    this.onTap,
    this.onLongPress,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Color color;
  final Widget? footer;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: color,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (subtitle case final text? when text.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    text,
                    style: const TextStyle(
                      color: HomeColors.muted,
                      fontSize: 13,
                    ),
                  ),
                ],
                ?footer,
              ],
            ),
          ),
          if (onTap != null) ...[
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: HomeColors.accent, size: 20),
          ],
        ],
      ),
    );
    if (onTap == null) return content;
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: content,
      ),
    );
  }
}
