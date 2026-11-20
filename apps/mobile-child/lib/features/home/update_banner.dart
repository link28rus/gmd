import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/updates/app_update_channel.dart';
import '../../core/updates/update_controller.dart';
import 'home_status_row.dart';

/// v0.56.0 — баннер самообновления на home. Виден только когда есть что
/// показать: загрузка, готовое обновление, ожидание подтверждения или сбой
/// загрузки/установки. Сбой проверки (нет сети) не показываем — фоновый
/// worker повторит через 6 часов.
/// Ручная проверка обновлений с сообщением об
/// итоге. Загрузку и готовое обновление дальше показывает [UpdateBanner].
Future<void> checkForUpdates(BuildContext context, WidgetRef ref) async {
  if (!Platform.isAndroid) return;
  final messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      const SnackBar(
        content: Text('Проверяем обновления…'),
        duration: Duration(minutes: 1),
      ),
    );
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
    AppUpdatePhase.pendingUserAction => 'Устанавливается обновление$v',
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
      if (mounted) {
        unawaited(ref.read(updateControllerProvider.notifier).checkOnOpen());
      }
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
      AppUpdatePhase.downloading => _UpdateRow(
        icon: Icons.downloading,
        title: 'Загружается обновление$version',
        subtitle: s.progress != null
            ? '${(s.progress! * 100).round()}%'
            : 'Подождите…',
        progress: s.progress,
      ),
      AppUpdatePhase.ready => _UpdateRow(
        icon: Icons.system_update,
        title: 'Доступно обновление$version',
        subtitle: s.canRequestInstall
            ? 'Приложение закроется на несколько секунд'
            : 'Android попросит разрешить установку обновлений',
        actionLabel: 'Обновить',
        onAction: notifier.install,
      ),
      AppUpdatePhase.installing => _UpdateRow(
        icon: Icons.system_update,
        title: 'Устанавливается обновление$version',
        subtitle: 'Приложение закроется на несколько секунд',
      ),
      AppUpdatePhase.pendingUserAction => _UpdateRow(
        icon: Icons.touch_app,
        color: HomeColors.warning,
        title: 'Подтвердите установку$version',
        subtitle: 'Android ждёт подтверждения',
        actionLabel: 'Установить',
        onAction: notifier.install,
      ),
      AppUpdatePhase.failed when s.lastErrorStage != 'check' => _UpdateRow(
        icon: Icons.error_outline,
        color: HomeColors.warning,
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

class _UpdateRow extends StatelessWidget {
  const _UpdateRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.color = HomeColors.accent,
    this.progress,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final double? progress;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return HomeStatusRow(
      icon: icon,
      title: title,
      subtitle: subtitle,
      color: color,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (progress != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: LinearProgressIndicator(
                value: progress,
                color: color,
                backgroundColor: HomeColors.iconSurface,
              ),
            ),
          if (actionLabel case final label? when onAction != null)
            TextButton(
              style: TextButton.styleFrom(foregroundColor: color),
              onPressed: onAction,
              child: Text(label),
            ),
        ],
      ),
    );
  }
}
