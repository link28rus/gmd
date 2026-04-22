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
        subtitle: 'В настройках включи «GMD родительский контроль» для полной защиты.',
        buttonLabel: 'Открыть',
        onTap: () =>
            ref.read(deviceAdminChannelProvider).openAccessibilitySettings(),
      );
    }

    return const SizedBox.shrink();
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
