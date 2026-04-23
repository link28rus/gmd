import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/config/env.dart';
import '../../core/native/device_admin_channel.dart';
import '../claim/claim_controller.dart';

// Состояние защиты = (enabled с backend) × (admin активен).
// В v0.29.2 L2 PIN-lock полностью убран — защита держится только на
// Device Admin L1, как у «Где мои дети» и «Пинго». Если родитель
// включил тумблер в кабинете, но Device Admin на устройстве не активен
// (свежая установка / сбой активации) — показываем жёлтую плашку
// «Включить защиту». Когда admin активен — плашка скрывается.
class ProtectionState {
  const ProtectionState({
    required this.enabled,
    required this.adminActive,
  });
  final bool enabled;
  final bool adminActive;

  bool get needAdmin => enabled && !adminActive;
  bool get allGood => enabled && adminActive;
}

final deviceAdminChannelProvider =
    Provider<DeviceAdminChannel>((_) => DeviceAdminChannel());

final protectionStateProvider = FutureProvider<ProtectionState?>((ref) async {
  final storage = ref.watch(secureStorageProvider);
  final token = await storage.readDeviceToken();
  if (token == null || token.isEmpty) return null;

  final admin = ref.watch(deviceAdminChannelProvider);
  await admin.saveNativeCreds(deviceToken: token, apiBaseUrl: apiBaseUrl);

  final api = ref.watch(childApiProvider);
  final enabled = await api.getProtection(deviceToken: token);
  if (enabled == null) return null;

  // Синхронизируем native-кеш — нужен в no-op AccessibilityService для
  // будущей совместимости и в общих целях (protection-гейты сервиса).
  await admin.setProtectionCache(enabled);

  var active = await admin.isActive();

  // Родитель выключил тумблер в кабинете — сами отзываем admin, чтобы
  // ребёнок мог удалить приложение через стандартный Settings → Apps.
  if (!enabled && active) {
    await admin.deactivate();
    active = false;
  }

  return ProtectionState(enabled: enabled, adminActive: active);
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
