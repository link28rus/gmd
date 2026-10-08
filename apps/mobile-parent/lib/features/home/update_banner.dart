import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/updates/app_update_channel.dart';
import '../../core/updates/update_controller.dart';

/// v0.56.0 — баннер самообновления на home. Виден только когда есть что
/// показать: загрузка, готовое обновление, ожидание подтверждения или сбой
/// загрузки/установки. Сбой проверки (нет сети) не показываем — фоновый
/// worker повторит через 6 часов.
/// Ручная проверка обновлений (нажатие на версию в шапке) с сообщением об
/// итоге. Загрузку и готовое обновление дальше показывает [UpdateBanner].
Future<void> checkForUpdates(BuildContext context, WidgetRef ref) async {
  if (!Platform.isAndroid) return;
  final messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(const SnackBar(
      content: Text('Проверяем обновления…'),
      duration: Duration(minutes: 1),
    ));
  final s = await ref.read(updateControllerProvider.notifier).checkManually();
  var installed = '';
  if (s?.phase == AppUpdatePhase.upToDate) {
    try {
      installed = ' ${(await PackageInfo.fromPlatform()).version}';
    } catch (_) {}
  }
  final v = s?.version != null ? ' ${s!.version}' : '';
  final text = switch (s?.phase) {
    AppUpdatePhase.upToDate => 'Установлена последняя версия$installed',
    AppUpdatePhase.downloading => 'Найдено обновление$v — загружается',
    AppUpdatePhase.ready => 'Обновление$v загружено — нажмите «Обновить»',
    AppUpdatePhase.installing ||
    AppUpdatePhase.pendingUserAction =>
      'Устанавливается обновление$v',
    AppUpdatePhase.checking =>
      'Сервер обновлений не отвечает — попробуйте позже',
    AppUpdatePhase.failed when s!.lastErrorStage == 'download' =>
      'Не удалось загрузить обновление$v',
    AppUpdatePhase.failed when s!.lastErrorStage == 'install' =>
      'Не удалось установить обновление$v',
    _ => 'Не удалось проверить обновления — проверьте интернет',
  };
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}

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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(updateControllerProvider.notifier).checkOnOpen());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final notifier = ref.read(updateControllerProvider.notifier);
    if (state == AppLifecycleState.resumed) {
      unawaited(notifier.checkOnOpen());
    } else if (state == AppLifecycleState.paused) {
      notifier.pause();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(updateControllerProvider);
    final notifier = ref.read(updateControllerProvider.notifier);
    if (s == null) return const SizedBox.shrink();
    final version = s.version != null ? ' ${s.version}' : '';

    return switch (s.phase) {
      AppUpdatePhase.downloading => _Card(
          color: Colors.blue.shade50,
          icon: Icons.downloading,
          iconColor: Colors.blue.shade700,
          title: 'Загружается обновление$version',
          subtitle: s.progress != null
              ? '${(s.progress! * 100).round()}%'
              : 'Подождите…',
          progress: s.progress,
        ),
      AppUpdatePhase.ready => _Card(
          color: Colors.green.shade50,
          icon: Icons.system_update,
          iconColor: Colors.green.shade700,
          title: 'Доступно обновление$version',
          subtitle: s.canRequestInstall
              ? 'Приложение закроется на несколько секунд'
              : 'Android попросит разрешить установку обновлений',
          actionLabel: 'Обновить',
          onAction: notifier.install,
        ),
      AppUpdatePhase.installing => _Card(
          color: Colors.green.shade50,
          icon: Icons.system_update,
          iconColor: Colors.green.shade700,
          title: 'Устанавливается обновление$version',
          subtitle: 'Приложение закроется на несколько секунд',
        ),
      AppUpdatePhase.pendingUserAction => _Card(
          color: Colors.orange.shade50,
          icon: Icons.touch_app,
          iconColor: Colors.orange.shade800,
          title: 'Подтвердите установку$version',
          subtitle: 'Android ждёт подтверждения',
          actionLabel: 'Установить',
          onAction: notifier.install,
        ),
      AppUpdatePhase.failed when s.lastErrorStage != 'check' => _Card(
          color: Colors.red.shade50,
          icon: Icons.error_outline,
          iconColor: Colors.red.shade700,
          title: s.lastErrorStage == 'install'
              ? 'Не удалось установить обновление'
              : 'Не удалось загрузить обновление',
          subtitle: s.lastError ?? '',
          actionLabel: 'Повторить',
          onAction: notifier.retry,
        ),
      _ => const SizedBox.shrink(),
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
  final double? progress;
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
                      // Фон карточки всегда светлый — цвет задаём явно,
                      // иначе в тёмной теме заголовок берёт светлый onSurface.
                      style: TextStyle(
                        color: Colors.grey.shade900,
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.grey.shade800,
                        fontSize: 12,
                      ),
                    ),
                    if (progress != null) ...[
                      const SizedBox(height: 8),
                      LinearProgressIndicator(
                        value: progress,
                        color: iconColor,
                        backgroundColor: iconColor.withValues(alpha: 0.15),
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
