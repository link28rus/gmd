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
  bool get allGood => enabled && adminActive && accessibilityActive;
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
        onTap: () => _showAccessibilityWizard(context),
      );
    }

    return const SizedBox.shrink();
  }

  Future<void> _showAccessibilityWizard(BuildContext context) async {
    final admin = ref.read(deviceAdminChannelProvider);
    final manufacturer = await admin.deviceManufacturer();
    final needsRestrictedUnlock =
        const ['xiaomi', 'redmi', 'poco'].contains(manufacturer);

    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) =>
          _AccessibilityWizard(needsRestrictedUnlock: needsRestrictedUnlock),
    );
  }
}

// Wizard с реактивным state: watch'ит protectionStateProvider, шаг 2 авто-
// помечается как ✓ когда accessibilityActive=true; после этого вся плашка
// исчезает, и сам sheet автозакрывается через callback. Шаг 1 (Xiaomi
// restricted settings) точно детектить нельзя без root — помечаем ✓ по
// эвристике: пользователь нажал кнопку + вернулся в приложение (resumed).
class _AccessibilityWizard extends ConsumerStatefulWidget {
  const _AccessibilityWizard({required this.needsRestrictedUnlock});
  final bool needsRestrictedUnlock;

  @override
  ConsumerState<_AccessibilityWizard> createState() =>
      _AccessibilityWizardState();
}

class _AccessibilityWizardState extends ConsumerState<_AccessibilityWizard>
    with WidgetsBindingObserver {
  bool _step1Visited = false;
  bool _awaitingReturnFromStep1 = false;
  bool _awaitingReturnFromStep2 = false;
  bool _autoClosed = false;

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
    if (state != AppLifecycleState.resumed) return;
    ref.invalidate(protectionStateProvider);
    if (_awaitingReturnFromStep1 && !_step1Visited) {
      setState(() {
        _step1Visited = true;
        _awaitingReturnFromStep1 = false;
      });
    }
    if (_awaitingReturnFromStep2) {
      _awaitingReturnFromStep2 = false;
    }
  }

  Future<void> _onStep1() async {
    _awaitingReturnFromStep1 = true;
    await ref.read(deviceAdminChannelProvider).openAppDetailsSettings();
  }

  Future<void> _onStep2() async {
    _awaitingReturnFromStep2 = true;
    await ref.read(deviceAdminChannelProvider).openAccessibilitySettings();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(protectionStateProvider);
    final state = async.valueOrNull;
    final a11yActive = state?.accessibilityActive ?? false;

    // Автозакрытие когда всё готово.
    if (a11yActive && !_autoClosed) {
      _autoClosed = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).maybePop();
      });
    }

    final needsRestricted = widget.needsRestrictedUnlock;
    final step2Done = a11yActive;
    final step1Done = needsRestricted ? (_step1Visited || step2Done) : step2Done;

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
              needsRestricted
                  ? 'На этом телефоне нужно два шага — MIUI/HyperOS блокирует спец.возможности для приложений не из Mi App Store.'
                  : 'Открой спец.возможности и включи «GMD родительский контроль».',
              style: const TextStyle(fontSize: 13, color: Colors.black54),
            ),
            const SizedBox(height: 24),
            if (needsRestricted) ...[
              _Step(
                n: 1,
                done: step1Done,
                title: 'Разрешить ограниченные настройки',
                body:
                    'Карточка приложения → ⋮ в правом верхнем углу → «Разрешить ограниченные настройки».',
                buttonLabel: 'Открыть карточку приложения',
                onTap: _onStep1,
              ),
              const SizedBox(height: 16),
              _Step(
                n: 2,
                done: step2Done,
                title: 'Включить спец.возможности',
                body:
                    'Спец.возможности → Скачанные приложения → gmd_child → тумблер.',
                buttonLabel: 'Открыть спец.возможности',
                onTap: _onStep2,
              ),
            ] else
              _Step(
                n: 1,
                done: step2Done,
                title: 'Включить спец.возможности',
                body:
                    'Спец.возможности → Скачанные приложения → gmd_child → тумблер.',
                buttonLabel: 'Открыть спец.возможности',
                onTap: _onStep2,
              ),
            if (a11yActive) ...[
              const SizedBox(height: 20),
              Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Защита настроена',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: Colors.green.shade800,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('Закрыть'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.n,
    required this.done,
    required this.title,
    required this.body,
    required this.buttonLabel,
    required this.onTap,
  });
  final int n;
  final bool done;
  final String title;
  final String body;
  final String buttonLabel;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    final markerColor = done ? Colors.green : Colors.orange;
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
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: markerColor,
              ),
              child: done
                  ? const Icon(Icons.check, color: Colors.white, size: 18)
                  : Text(
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
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      decoration: done ? TextDecoration.lineThrough : null,
                      color: done ? Colors.black45 : Colors.black,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    body,
                    style: const TextStyle(fontSize: 13, color: Colors.black54),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (!done) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: () => onTap(),
              child: Text(buttonLabel),
            ),
          ),
        ],
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
