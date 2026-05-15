import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/updates/update_controller.dart';

/// Auto-update — баннер на главной. После перехода на RuStore SDK
/// (lesson #24) сам процесс update'а — модальный SDK-экран RuStore, баннер
/// нужен только для UpdateFailed: если SDK threw — кнопка «Повторить».
/// Idle / Checking / NotNeeded — SizedBox.shrink().
class UpdateBanner extends ConsumerStatefulWidget {
  const UpdateBanner({super.key});

  @override
  ConsumerState<UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends ConsumerState<UpdateBanner> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(updateControllerProvider.notifier).checkAndAutoInstall());
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(updateControllerProvider);
    final notifier = ref.read(updateControllerProvider.notifier);

    return switch (state) {
      UpdateIdle() || UpdateChecking() || UpdateNotNeeded() =>
        const SizedBox.shrink(),
      UpdateFailed(:final message) => _Card(
          color: Colors.red.shade50,
          icon: Icons.error_outline,
          iconColor: Colors.red.shade700,
          title: 'Не удалось проверить обновления',
          subtitle: message,
          actionLabel: 'Повторить',
          onAction: () => notifier.retry(),
        ),
    };
  }
}

class _Card extends StatelessWidget {
  const _Card({
    required this.color,
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  final Color color;
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: iconColor, size: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: Colors.grey.shade800,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(width: 8),
                FilledButton.tonal(
                  onPressed: onAction,
                  style: FilledButton.styleFrom(
                    backgroundColor: iconColor.withValues(alpha: 0.15),
                    foregroundColor: iconColor,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                  ),
                  child: Text(actionLabel!),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
