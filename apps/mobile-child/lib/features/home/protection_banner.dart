import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/config/env.dart';
import '../../core/native/device_admin_channel.dart';
import '../claim/claim_controller.dart';

// Состояние защиты = (enabled с backend) × (admin активен).
// В v0.29.2 L2 PIN-lock полностью убран — защита держится только на
// Device Admin L1. В v0.29.3 добавлен Xiaomi-wizard для MIUI/HyperOS:
// на этих прошивках для sideload-APK активация Device Admin блокируется
// «Ограниченными настройками» (Restricted Settings), и без инструкции
// ребёнок (и большинство родителей) не знают что делать — получается
// видимый тумблер ON в кабинете при НЕ активном admin на устройстве,
// т.е. защиты фактически нет (launcher → long-press → trash проходит).
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
  final enabledFromApi = await api.getProtection(deviceToken: token);

  var active = await admin.isActive();

  // Если backend недоступен — НЕ прячем банер. Полагаемся на локальный
  // native-кеш и факт активности admin. В худшем случае банер покажется
  // «лишний раз», но это лучше чем невидимая защита.
  final enabled = enabledFromApi ?? true;

  await admin.setProtectionCache(enabled);

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
  bool _autoShownOnce = false;

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
      // Однократный автопоказ диалога при первом появлении «needAdmin»:
      // если ребёнок только что открыл home и защита не активна,
      // сразу показываем sheet с инструкциями, чтоб не полагаться на
      // самостоятельный тап по banner.
      if (!_autoShownOnce) {
        _autoShownOnce = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _showAdminWizard(context);
        });
      }
      return _Banner(
        // Красная (вместо жёлтой в v0.29.2) — защита ФАКТИЧЕСКИ не работает,
        // приложение можно удалить launcher'ом. Чтоб ребёнок/родитель
        // точно обратил внимание.
        color: Colors.red,
        title: 'Защита НЕ активна',
        subtitle:
            'Устройство можно удалить. Нажми чтобы включить Device Admin.',
        buttonLabel: 'Включить',
        onTap: () => _showAdminWizard(context),
      );
    }

    return const SizedBox.shrink();
  }

  Future<void> _showAdminWizard(BuildContext context) async {
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
          _AdminWizard(needsRestrictedUnlock: needsRestrictedUnlock),
    );
  }
}

// Wizard для активации Device Admin. На Xiaomi/Redmi/Poco — 2 шага:
//   1. «Разрешить ограниченные настройки» в карточке приложения
//      (без этого MIUI/HyperOS блокирует ACTION_ADD_DEVICE_ADMIN)
//   2. Нажать кнопку «Включить защиту» → system dialog → подтвердить
// На остальных прошивках — 1 шаг (сразу activation).
// Закрывается автоматически когда adminActive=true.
class _AdminWizard extends ConsumerStatefulWidget {
  const _AdminWizard({required this.needsRestrictedUnlock});
  final bool needsRestrictedUnlock;

  @override
  ConsumerState<_AdminWizard> createState() => _AdminWizardState();
}

class _AdminWizardState extends ConsumerState<_AdminWizard>
    with WidgetsBindingObserver {
  bool _step1Visited = false;
  bool _awaitingReturnFromStep1 = false;
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
  }

  Future<void> _onStep1() async {
    _awaitingReturnFromStep1 = true;
    await ref.read(deviceAdminChannelProvider).openAppDetailsSettings();
  }

  Future<void> _onStep2() async {
    // После requestActivation onActivityResult приходит в MainActivity,
    // а resumed lifecycle на home триггерит invalidate провайдера.
    await ref.read(deviceAdminChannelProvider).requestActivation();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(protectionStateProvider);
    final state = async.valueOrNull;
    final adminActive = state?.adminActive ?? false;

    if (adminActive && !_autoClosed) {
      _autoClosed = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).maybePop();
      });
    }

    final needsRestricted = widget.needsRestrictedUnlock;
    final step2Done = adminActive;
    final step1Done = needsRestricted ? (_step1Visited || step2Done) : step2Done;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Включение защиты от удаления',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              needsRestricted
                  ? 'На этом телефоне MIUI/HyperOS блокирует Device Admin для приложений не из Mi App Store — нужно 2 шага.'
                  : 'Разреши приложению роль администратора устройства — это даст защиту от случайного удаления.',
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
                title: 'Включить Device Admin',
                body:
                    'Нажми кнопку → в системном диалоге подтверди «Разрешить управлять устройством».',
                buttonLabel: 'Включить защиту',
                onTap: _onStep2,
              ),
            ] else
              _Step(
                n: 1,
                done: step2Done,
                title: 'Включить Device Admin',
                body:
                    'Нажми кнопку → в системном диалоге подтверди «Разрешить управлять устройством».',
                buttonLabel: 'Включить защиту',
                onTap: _onStep2,
              ),
            if (adminActive) ...[
              const SizedBox(height: 20),
              Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Защита активна',
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
                        style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: color.shade900)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: color.shade700),
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
