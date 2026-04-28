import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/updates/update_controller.dart';

/// v0.40 auto-update — баннер на home_screen.
///
/// Показывается ТОЛЬКО когда есть обновление (UpdateDownloading /
/// UpdateDownloaded / UpdateNeedsPermission / UpdateFailed). При UpdateIdle /
/// UpdateChecking / UpdateNotNeeded / UpdateInstallerLaunched — пустой
/// SizedBox.shrink(), чтобы не занимать место.
///
/// Lifecycle: на init дёргает `checkAndAutoInstall()` один раз (на каждом
/// открытии home — устройство ребёнка может не перезагружаться месяцами,
/// поэтому полагаться только на app cold-start нельзя). Также реагирует на
/// resume — после возврата из settings перепроверяет permission.
class UpdateBanner extends ConsumerStatefulWidget {
  const UpdateBanner({super.key});

  @override
  ConsumerState<UpdateBanner> createState() => _UpdateBannerState();
}

class _UpdateBannerState extends ConsumerState<UpdateBanner>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // На первом frame дёргаем check. Откладываем чтобы не блокировать build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(updateControllerProvider.notifier).checkAndAutoInstall());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Возможно user только что разрешил «Установка из неизвестных источников».
      unawaited(
        ref.read(updateControllerProvider.notifier).recheckPermissionIfPending(),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(updateControllerProvider);
    final notifier = ref.read(updateControllerProvider.notifier);

    return switch (state) {
      UpdateIdle() ||
      UpdateChecking() ||
      UpdateNotNeeded() ||
      UpdateInstallerLaunched() =>
        const SizedBox.shrink(),
      UpdateDownloading() => _Card(
          color: Colors.blue.shade50,
          icon: Icons.cloud_download_outlined,
          iconColor: Colors.blue.shade700,
          title: 'Скачиваем обновление ${state.info.displayVersion}',
          subtitle:
              '${state.percent}% • ${state.info.sizeHumanReadable} • установится автоматически',
          progress: state.progress,
        ),
      UpdateDownloaded(:final info) => _Card(
          color: Colors.green.shade50,
          icon: Icons.check_circle_outline,
          iconColor: Colors.green.shade700,
          title: 'Обновление готово ${info.displayVersion}',
          subtitle: 'Открой системный установщик чтобы поставить',
          actionLabel: 'Установить',
          onAction: () => notifier.launchInstaller(),
        ),
      UpdateNeedsPermission(:final info) => _Card(
          color: Colors.orange.shade50,
          icon: Icons.security,
          iconColor: Colors.orange.shade800,
          title: 'Нужно разрешение',
          subtitle:
              'Чтобы установить обновление ${info.displayVersion}, разреши установку из этого приложения в системных настройках',
          actionLabel: 'Открыть настройки',
          onAction: () => notifier.openInstallSourceSettings(),
        ),
      UpdateFailed(:final message, :final info) => _Card(
          color: Colors.red.shade50,
          icon: Icons.error_outline,
          iconColor: Colors.red.shade700,
          title: info != null
              ? 'Не удалось обновить до ${info.displayVersion}'
              : 'Не удалось проверить обновления',
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
    this.progress,
    this.actionLabel,
    this.onAction,
  });

  final Color color;
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;

  /// Если задано — показывается LinearProgressIndicator под subtitle.
  /// null = неопределённый (indeterminate).
  final double? progress;

  /// Если задано — показывается FilledButton.tonal в правой части.
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
                    if (progress != null || actionLabel == null) ...[
                      const SizedBox(height: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: progress,
                          minHeight: 6,
                          color: iconColor,
                          backgroundColor: iconColor.withValues(alpha: 0.15),
                        ),
                      ),
                    ],
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
