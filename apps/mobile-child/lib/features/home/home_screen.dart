import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/child_api.dart';
import '../../core/native/dialer_channel.dart';
import '../../core/version/app_version.dart';
import '../sos/sos_controller.dart';
import 'activity_recognition_banner.dart';
import 'home_controller.dart';
import 'home_status_row.dart';
import 'location_profile_indicator.dart';
import 'microphone_permission_guard.dart';
import 'permission_health_banner.dart';
import 'post_update_rescue.dart';
import 'protection_banner.dart';
import 'update_banner.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _confirmingSos = false;

  @override
  Widget build(BuildContext context) {
    ref.listen<AsyncValue<ChildMeResult>>(homeInitProvider, (_, next) {
      if (next is AsyncData<ChildMeResult> && !next.value.tokenValid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Устройство отвязано от семьи. Отсканируй новый QR-код для привязки.',
            ),
            duration: Duration(seconds: 6),
          ),
        );
        context.go('/onboarding');
      }
    });
    final connection = ref.watch(homeInitProvider);
    final sos = ref.watch(sosControllerProvider);

    return Scaffold(
      backgroundColor: HomeColors.background,
      appBar: AppBar(
        backgroundColor: HomeColors.background,
        foregroundColor: HomeColors.accent,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        title: const Text(
          'Перископ',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const MicrophonePermissionGuard(),
                  const PostUpdateRescueGate(),
                  _FamilyPanel(
                    connection: connection,
                    onRetry: () => ref.invalidate(homeInitProvider),
                  ),
                  const SizedBox(height: 20),
                  _SosButton(
                    sending: sos.status == SosStatus.sending,
                    onConfirm: _confirmAndSend,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Удерживай SOS, чтобы позвать на помощь',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: HomeColors.muted, fontSize: 14),
                  ),
                  _SosFeedback(state: sos),
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    onPressed: _openDialer,
                    icon: const Icon(Icons.call_outlined),
                    label: const Text('Позвонить', textAlign: TextAlign.center),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: HomeColors.accent,
                      backgroundColor: HomeColors.surface,
                      minimumSize: const Size.fromHeight(52),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      side: const BorderSide(color: HomeColors.outline),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  _AppStatus(
                    onCheckUpdates: () => checkForUpdates(context, ref),
                    onDiagnostics: () => context.push('/debug'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _confirmAndSend() async {
    if (_confirmingSos ||
        ref.read(sosControllerProvider).status == SosStatus.sending) {
      return;
    }
    _confirmingSos = true;
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          scrollable: true,
          backgroundColor: HomeColors.surface,
          titleTextStyle: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(color: Colors.white),
          contentTextStyle: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: HomeColors.muted),
          title: const Text('Отправить SOS?'),
          content: const Text('Отправим сигнал и твоё местоположение.'),
          actions: [
            TextButton(
              style: TextButton.styleFrom(foregroundColor: HomeColors.accent),
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: HomeColors.sos,
                foregroundColor: Colors.white,
              ),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Да, отправить'),
            ),
          ],
        ),
      );
      if (confirmed == true && mounted) {
        await ref.read(sosControllerProvider.notifier).send();
      }
    } finally {
      _confirmingSos = false;
    }
  }

  Future<void> _openDialer() async {
    final opened = await DialerChannel.open();
    if (!opened && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('Не удалось открыть приложение «Телефон»'),
          ),
        );
    }
  }
}

class _FamilyPanel extends StatelessWidget {
  const _FamilyPanel({required this.connection, required this.onRetry});

  final AsyncValue<ChildMeResult> connection;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final result = connection.valueOrNull;
    final name = result?.familyName?.trim();
    final (status, icon) = switch (connection) {
      _ when connection.isLoading => ('Проверяем связь…', Icons.sync),
      AsyncData(:final value) when value.serverVerified => (
        'Сервер ответил',
        Icons.check_circle_outline,
      ),
      AsyncData(:final value) when !value.tokenValid => (
        'Устройство отвязано',
        Icons.link_off,
      ),
      _ => ('Связь не проверена', Icons.cloud_off_outlined),
    };

    return Material(
      color: HomeColors.surface,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 4, 12),
        child: Row(
          children: [
            const DecoratedBox(
              decoration: BoxDecoration(
                color: HomeColors.iconSurface,
                borderRadius: BorderRadius.all(Radius.circular(14)),
              ),
              child: SizedBox.square(
                dimension: 44,
                child: Icon(Icons.people_outline, color: HomeColors.accent),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name == null || name.isEmpty ? 'Семья' : name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Semantics(
                    liveRegion: true,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(icon, size: 17, color: HomeColors.accent),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            status,
                            style: const TextStyle(
                              color: HomeColors.muted,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Проверить связь',
              color: HomeColors.accent,
              disabledColor: HomeColors.outline,
              onPressed: connection.isLoading ? null : onRetry,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
      ),
    );
  }
}

class _SosButton extends StatefulWidget {
  const _SosButton({required this.sending, required this.onConfirm});

  final bool sending;
  final VoidCallback onConfirm;

  @override
  State<_SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<_SosButton> {
  bool _showFocus = false;

  @override
  Widget build(BuildContext context) {
    final confirm = widget.sending ? null : widget.onConfirm;
    return Semantics(
      excludeSemantics: true,
      button: true,
      enabled: !widget.sending,
      label: 'SOS',
      hint: confirm == null ? null : 'Открыть подтверждение отправки',
      onTap: confirm,
      onLongPress: confirm,
      child: FocusableActionDetector(
        enabled: !widget.sending,
        onShowFocusHighlight: (show) => setState(() => _showFocus = show),
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(
            onInvoke: (_) => confirm?.call(),
          ),
        },
        child: Material(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
            side: _showFocus
                ? const BorderSide(color: Colors.white, width: 3)
                : BorderSide.none,
          ),
          clipBehavior: Clip.antiAlias,
          color: widget.sending ? HomeColors.sosSending : HomeColors.sos,
          child: InkWell(
            canRequestFocus: false,
            onLongPress: confirm,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 100),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (widget.sending)
                      const SizedBox.square(
                        dimension: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    else
                      const Icon(
                        Icons.emergency_outlined,
                        color: Colors.white,
                        size: 28,
                      ),
                    const SizedBox(width: 12),
                    const Flexible(
                      child: Text(
                        'SOS',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SosFeedback extends StatelessWidget {
  const _SosFeedback({required this.state});

  final SosState state;

  @override
  Widget build(BuildContext context) {
    final (message, icon, color) = switch (state.status) {
      SosStatus.idle => (null, null, HomeColors.muted),
      SosStatus.sending => (
        'Отправляем сигнал…',
        Icons.sync,
        HomeColors.accent,
      ),
      SosStatus.success => (
        'Сигнал принят',
        Icons.check_circle_outline,
        HomeColors.accent,
      ),
      SosStatus.error => (
        'Не удалось отправить SOS',
        Icons.error_outline,
        HomeColors.warning,
      ),
    };
    if (message == null) return const SizedBox.shrink();

    final detail = state.errorMessage;
    return Semantics(
      liveRegion: true,
      child: HomeStatusRow(
        icon: icon!,
        title: message,
        color: color,
        subtitle:
            detail != null && !detail.startsWith('Не удалось отправить SOS')
            ? detail
            : null,
      ),
    );
  }
}

class _AppStatus extends StatelessWidget {
  const _AppStatus({required this.onCheckUpdates, required this.onDiagnostics});

  final VoidCallback onCheckUpdates;
  final VoidCallback onDiagnostics;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: HomeColors.surface,
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, 4),
            child: Text(
              'Состояние приложения',
              style: TextStyle(
                color: HomeColors.muted,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const PermissionHealthBanner(),
          const ProtectionBanner(),
          const ActivityRecognitionBanner(),
          const UpdateBanner(),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 6, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: LocationProfileIndicator(),
            ),
          ),
          HomeStatusRow(
            icon: Icons.system_update_alt,
            title: 'Проверить обновления',
            footer: const AppVersionLabel(
              style: TextStyle(color: HomeColors.muted, fontSize: 12),
            ),
            onTap: onCheckUpdates,
            onLongPress: onDiagnostics,
          ),
        ],
      ),
    );
  }
}
