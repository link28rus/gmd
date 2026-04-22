import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/native/device_admin_channel.dart';
import '../claim/claim_controller.dart';

// Состояние защиты = (enabled с backend) × (admin активен на устройстве).
// UI реагирует на расхождение: backend говорит «надо включить», а на устройстве
// Device Admin ещё не активирован → показываем banner с кнопкой «Включить».
class ProtectionState {
  const ProtectionState({required this.enabled, required this.adminActive});
  final bool enabled;
  final bool adminActive;

  bool get actionNeeded => enabled && !adminActive;
}

final deviceAdminChannelProvider =
    Provider<DeviceAdminChannel>((_) => DeviceAdminChannel());

final protectionStateProvider = FutureProvider<ProtectionState?>((ref) async {
  final storage = ref.watch(secureStorageProvider);
  final token = await storage.readDeviceToken();
  if (token == null || token.isEmpty) return null;

  final api = ref.watch(childApiProvider);
  final enabled = await api.getProtection(deviceToken: token);
  if (enabled == null) return null; // сетевая ошибка — UI оставит как было

  final admin = ref.watch(deviceAdminChannelProvider);
  final active = await admin.isActive();
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
    if (state == null || !state.actionNeeded) return const SizedBox.shrink();

    return Material(
      color: Colors.amber.shade100,
      child: InkWell(
        onTap: () => _activate(context),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Icon(Icons.shield_outlined, color: Colors.amber.shade900),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Защита приложения не включена',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Родители просят включить защиту от случайного удаления.',
                      style: TextStyle(fontSize: 12),
                    ),
                  ],
                ),
              ),
              FilledButton(
                onPressed: () => _activate(context),
                child: const Text('Включить'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _activate(BuildContext context) async {
    final admin = ref.read(deviceAdminChannelProvider);
    await admin.requestActivation();
    // Состояние перечитается через didChangeAppLifecycleState.resumed, когда
    // пользователь вернётся из системного диалога.
  }
}
