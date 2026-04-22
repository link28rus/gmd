import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/config/env.dart';
import '../../core/native/device_admin_channel.dart';
import '../claim/claim_controller.dart';

// Состояние защиты = (enabled с backend) × (admin активен) × (accessibility
// активен). UI показывает:
//  - жёлтая плашка «Включить защиту» если Device Admin не активен
//  - оранжевая плашка «Настроить блокировку» если Device Admin есть, но
//    Accessibility Service (L2) не включён
//  - ничего — если оба включены ИЛИ protection выключен на backend
class ProtectionState {
  const ProtectionState({
    required this.enabled,
    required this.adminActive,
    required this.accessibilityActive,
  });
  final bool enabled;
  final bool adminActive;
  final bool accessibilityActive;

  bool get needAdmin => enabled && !adminActive;
  bool get needAccessibility => enabled && adminActive && !accessibilityActive;
}

final deviceAdminChannelProvider =
    Provider<DeviceAdminChannel>((_) => DeviceAdminChannel());

final protectionStateProvider = FutureProvider<ProtectionState?>((ref) async {
  final storage = ref.watch(secureStorageProvider);
  final token = await storage.readDeviceToken();
  if (token == null || token.isEmpty) return null;

  final admin = ref.watch(deviceAdminChannelProvider);
  // Зеркалим token+apiBaseUrl в plain SharedPreferences — нативная
  // PinLockActivity (Kotlin) читает их оттуда и делает HTTP-запрос без
  // Flutter engine.
  await admin.saveNativeCreds(deviceToken: token, apiBaseUrl: apiBaseUrl);

  final api = ref.watch(childApiProvider);
  final enabled = await api.getProtection(deviceToken: token);
  if (enabled == null) return null;

  final active = await admin.isActive();
  final a11y = await admin.isAccessibilityEnabled();
  return ProtectionState(
    enabled: enabled,
    adminActive: active,
    accessibilityActive: a11y,
  );
});

class ProtectionBanner extends ConsumerStatefulWidget {
  const ProtectionBanner({super.key});

  @override
  ConsumerState<ProtectionBanner> createState() => _ProtectionBannerState();
}

class _ProtectionBannerState extends ConsumerState<ProtectionBanner>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Возврат в приложение после системного диалога Device Admin — самое
    // надёжное место перепроверить isActive. Даже если пользователь нажал
    // «Отмена», состояние точно не стало хуже.
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(protectionStateProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(protectionStateProvider);
    final state = async.valueOrNull;
    if (state == null) return const SizedBox.shrink();

    if (state.needAdmin) {
      return _Banner(
        color: Colors.amber,
        title: 'Защита приложения не включена',
        subtitle: 'Родители просят включить защиту от удаления.',
        buttonLabel: 'Включить',
        onTap: () => ref.read(deviceAdminChannelProvider).requestActivation(),
      );
    }

    if (state.needAccessibility) {
      return _Banner(
        color: Colors.orange,
        title: 'Остался один шаг',
        subtitle: 'Включи «GMD родительский контроль» в спец.возможностях.',
        buttonLabel: 'Открыть',
        onTap: () => _showAccessibilityWizard(context, ref),
      );
    }

    return const SizedBox.shrink();
  }

  Future<void> _showAccessibilityWizard(BuildContext context, WidgetRef ref) async {
    final admin = ref.read(deviceAdminChannelProvider);
    final manufacturer = await admin.deviceManufacturer();
    final needsRestrictedUnlock = const ['xiaomi', 'redmi', 'poco'].contains(manufacturer);

    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) => _AccessibilityWizard(
        needsRestrictedUnlock: needsRestrictedUnlock,
        onOpenAppDetails: () => admin.openAppDetailsSettings(),
        onOpenAccessibility: () => admin.openAccessibilitySettings(),
      ),
    );
  }
}

// Для Xiaomi/Redmi/POCO: первым шагом открываем карточку приложения, чтобы
// пользователь в меню ⋮ нажал «Разрешить ограниченные настройки» (без этого
// HyperOS блокирует включение Accessibility для sideload-APK). Вторым шагом —
// Accessibility Settings. На stock-устройствах шаг «Разрешить» не нужен, но
// его ненавязчивое наличие не ломает UX (скрываем через needsRestrictedUnlock).
class _AccessibilityWizard extends StatelessWidget {
  const _AccessibilityWizard({
    required this.needsRestrictedUnlock,
    required this.onOpenAppDetails,
    required this.onOpenAccessibility,
  });

  final bool needsRestrictedUnlock;
  final Future<void> Function() onOpenAppDetails;
  final Future<void> Function() onOpenAccessibility;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Включение полной защиты',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              needsRestrictedUnlock
                  ? 'На этом телефоне нужно два шага — MIUI/HyperOS блокирует спец.возможности для приложений не из Mi App Store.'
                  : 'Открой спец.возможности и включи «GMD родительский контроль».',
              style: const TextStyle(fontSize: 13, color: Colors.black54),
            ),
            const SizedBox(height: 24),
            if (needsRestrictedUnlock) ...[
              _Step(
                n: 1,
                title: 'Разрешить ограниченные настройки',
                body:
                    'Откроется карточка приложения → нажми ⋮ в правом верхнем углу → выбери «Разрешить ограниченные настройки».',
                buttonLabel: 'Открыть карточку приложения',
                onTap: onOpenAppDetails,
              ),
              const SizedBox(height: 16),
              _Step(
                n: 2,
                title: 'Включить спец.возможности',
                body:
                    'Спец.возможности → Скачанные приложения → gmd_child → включи тумблер.',
                buttonLabel: 'Открыть спец.возможности',
                onTap: onOpenAccessibility,
              ),
            ] else
              _Step(
                n: 1,
                title: 'Включить спец.возможности',
                body:
                    'Спец.возможности → Скачанные приложения → gmd_child → включи тумблер.',
                buttonLabel: 'Открыть спец.возможности',
                onTap: onOpenAccessibility,
              ),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.n,
    required this.title,
    required this.body,
    required this.buttonLabel,
    required this.onTap,
  });
  final int n;
  final String title;
  final String body;
  final String buttonLabel;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 28,
              height: 28,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.orange,
              ),
              child: Text(
                '$n',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  Text(body,
                      style:
                          const TextStyle(fontSize: 13, color: Colors.black54)),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            onPressed: () => onTap(),
            child: Text(buttonLabel),
          ),
        ),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.color,
    required this.title,
    required this.subtitle,
    required this.buttonLabel,
    required this.onTap,
  });
  final MaterialColor color;
  final String title;
  final String subtitle;
  final String buttonLabel;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.shade100,
      child: InkWell(
        onTap: () => onTap(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Icon(Icons.shield_outlined, color: color.shade900),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
              FilledButton(
                onPressed: () => onTap(),
                child: Text(buttonLabel),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
