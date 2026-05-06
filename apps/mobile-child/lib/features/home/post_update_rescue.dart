import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/native/app_control_channel.dart';
import '../../core/native/device_admin_channel.dart';

/// Задача #61: активный rescue после автообновления APK.
///
/// На HyperOS / MIUI 14+ / некоторых других OEM при обновлении из
/// sideload-источника (`/api/public/updates/...` → PackageInstaller через
/// ACTION_VIEW) система деактивирует:
///   - AccessibilityService (для блокировки приложений)
///   - Device Admin (для защиты от удаления)
/// Это **известное поведение OS**, технически предотвратить нельзя.
///
/// До этого виджета у нас были пассивные баннеры — `PermissionHealthBanner`
/// и `ProtectionBanner` — которые ребёнок мог не заметить, открывая home
/// и сразу нажимая SOS-кнопку. Этот виджет работает active:
///
///   1. При init слушает `AppControlChannel.consumePostUpdateFlag()` —
///      one-shot native flag «первый запуск после смены versionCode».
///   2. Если флаг pending → проверяем критические permissions
///      (a11y + Device Admin). Если хотя бы одно слетело → показываем
///      `AlertDialog` с заголовком «После обновления слетели разрешения»
///      и списком конкретных проблем + кнопками-shortcut'ами.
///   3. Кнопки ведут в существующие onboarding-step'ы / wizard
///      (`accessibility_step.dart`, `_AdminWizard` через `ProtectionBanner`).
///   4. После закрытия модала пассивные баннеры подхватывают остальное.
///
/// Идемпотентен: native flag clear'ится при первом consume (даже если в
/// этот момент permissions всё ещё ОК — модал просто не показывается, но
/// флаг съеден). Повторное обновление APK снова поставит флаг.
class PostUpdateRescueGate extends ConsumerStatefulWidget {
  const PostUpdateRescueGate({super.key});

  @override
  ConsumerState<PostUpdateRescueGate> createState() =>
      _PostUpdateRescueGateState();
}

class _PostUpdateRescueGateState extends ConsumerState<PostUpdateRescueGate> {
  bool _checked = false;

  @override
  void initState() {
    super.initState();
    // postFrameCallback гарантирует что модал откроется поверх готового
    // home-экрана (showDialog требует Material-context).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_runOnce());
    });
  }

  Future<void> _runOnce() async {
    if (_checked) return;
    _checked = true;
    final PostUpdateInfo? info;
    try {
      info = await AppControlChannel.consumePostUpdateFlag();
    } on Object {
      // Channel-error на iOS / web / без native-side — silent skip.
      return;
    }
    if (info == null) return; // Не первый запуск после обновления.
    if (!mounted) return;

    // Проверяем те permissions которые ИЗВЕСТНО слетают на HyperOS/MIUI.
    final missing = <_RescueItem>[];

    final a11y = await AppControlChannel.isAccessibilityServiceEnabled();
    if (!a11y) {
      missing.add(_RescueItem(
        title: 'Блокировка приложений',
        description:
            'Спецвозможности (Accessibility) — без неё родитель не сможет '
            'блокировать игры и соцсети.',
        action: _RescueAction.openAccessibilitySettings,
      ));
    }

    final adminActive = await DeviceAdminChannel().isActive();
    if (!adminActive) {
      missing.add(_RescueItem(
        title: 'Защита от удаления',
        description:
            'Device Admin — без него приложение можно удалить через launcher, '
            'и родительский контроль перестанет работать.',
        action: _RescueAction.requestDeviceAdmin,
      ));
    }

    // SAW (overlay) — на HyperOS обычно сохраняется (привязан к UID), но
    // проверяем для надёжности; это критично для visual blocking overlay.
    final canOverlay = await AppControlChannel.canDrawOverlays();
    if (!canOverlay) {
      missing.add(_RescueItem(
        title: 'Поверх других приложений',
        description:
            'Без этого блокировка работает, но без визуального экрана-заглушки.',
        action: _RescueAction.openOverlaySettings,
      ));
    }

    // Уведомления — Android 13+. На HyperOS теоретически тоже могут слетать
    // при clean-reinstall (если подписи различаются — но мы это исключили
    // в фазе 1 диагностики; оставляем check на всякий случай).
    final notif = await Permission.notification.status;
    if (!notif.isGranted) {
      missing.add(_RescueItem(
        title: 'Уведомления',
        description:
            'Без уведомлений родитель не сможет позвать тебя, и фоновый '
            'трекинг будет отключаться системой.',
        action: _RescueAction.openNotificationsStep,
      ));
    }

    if (missing.isEmpty) {
      // Обновление прошло, разрешения сохранились. Молча выходим — флаг уже
      // consume'нут native-стороной, повторно модал не покажется.
      return;
    }
    if (!mounted) return;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _RescueDialog(info: info!, items: missing),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Виджет невидимый — вся логика в showDialog поверх home.
    return const SizedBox.shrink();
  }
}

enum _RescueAction {
  openAccessibilitySettings,
  requestDeviceAdmin,
  openOverlaySettings,
  openNotificationsStep,
}

class _RescueItem {
  const _RescueItem({
    required this.title,
    required this.description,
    required this.action,
  });

  final String title;
  final String description;
  final _RescueAction action;
}

class _RescueDialog extends ConsumerWidget {
  const _RescueDialog({required this.info, required this.items});

  final PostUpdateInfo info;
  final List<_RescueItem> items;

  Future<void> _handle(BuildContext ctx, WidgetRef ref, _RescueAction a) async {
    // Закрываем модал ДО navigate/intent чтобы не оставлять его в стеке поверх
    // системных настроек (после возврата всё равно сработают пассивные
    // баннеры — `PermissionHealthBanner` + `ProtectionBanner`).
    Navigator.of(ctx).pop();
    switch (a) {
      case _RescueAction.openAccessibilitySettings:
        if (ctx.mounted) {
          ctx.go('/permissions/accessibility');
        }
        break;
      case _RescueAction.requestDeviceAdmin:
        // ProtectionBanner на home сам авто-покажет _AdminWizard через
        // _autoShownOnce когда определит needAdmin=true. Просто открываем
        // home и доверяем существующему flow.
        if (ctx.mounted) {
          ctx.go('/home');
        }
        break;
      case _RescueAction.openOverlaySettings:
        if (ctx.mounted) {
          ctx.go('/permissions/overlay');
        }
        break;
      case _RescueAction.openNotificationsStep:
        if (ctx.mounted) {
          ctx.go('/permissions/notifications');
        }
        break;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final from = info.fromVersionName.isNotEmpty ? info.fromVersionName : '?';
    final to = info.toVersionName.isNotEmpty ? info.toVersionName : '?';
    return AlertDialog(
      icon: Icon(Icons.system_update_alt, color: Colors.orange.shade700, size: 36),
      title: const Text('После обновления слетели разрешения'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Приложение обновилось с v$from на v$to. '
              'На некоторых телефонах (Xiaomi/Redmi/HyperOS) после обновления '
              'система выключает часть разрешений — это нужно исправить, '
              'иначе родительский контроль перестанет работать.',
              style: const TextStyle(fontSize: 13.5),
            ),
            const SizedBox(height: 16),
            for (final item in items) ...[
              _ItemTile(
                item: item,
                onTap: () => _handle(context, ref, item.action),
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Позже'),
        ),
      ],
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item, required this.onTap});

  final _RescueItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: Colors.orange.shade50,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(Icons.warning_amber, color: Colors.orange.shade900, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      item.description,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.orange.shade900),
            ],
          ),
        ),
      ),
    );
  }
}
