import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../consent/consent_providers.dart';
import '../zones/zone_format.dart' show apiExceptionOf;
import 'family_models.dart';
import 'family_providers.dart';
import 'widgets/family_dialogs.dart';

/// Превью приглашения по коду. autoDispose — без кэша между попытками.
final invitePreviewProvider = FutureProvider.autoDispose.family<InvitePreview, String>((ref, code) {
  return ref.watch(familyRepositoryProvider).preview(code);
});

/// v0.71.0: превью приглашения в семью и «Присоединиться».
/// Маршрут `/home/family/join/:code` (код вводится вручную, глубоких ссылок нет).
class JoinFamilyScreen extends ConsumerStatefulWidget {
  const JoinFamilyScreen({super.key, required this.code});

  final String code;

  @override
  ConsumerState<JoinFamilyScreen> createState() => _JoinFamilyScreenState();
}

class _JoinFamilyScreenState extends ConsumerState<JoinFamilyScreen> {
  bool _busy = false;

  String get _code => normalizeInviteCode(widget.code);

  Future<void> _join(InvitePreview preview) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final family = await ref.read(familyRepositoryProvider).accept(_code);
      await applyMembershipChange(ref, family: family, role: FamilyRole.parent);
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      context.go('/home');
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('Вы присоединились к семье «${family.name}»')));
    } catch (e) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Не удалось присоединиться'),
          content: Text(familyErrorMessage(e)),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Понятно')),
          ],
        ),
      );
      // Состояние могло измениться (приглашение использовано, появились дети).
      ref.invalidate(invitePreviewProvider(_code));
      // v0.72.0: роутер откроет экран принятия политики.
      if (mounted) markConsentRequired(ref, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _otherCode() async {
    final code = await showInviteCodeDialog(context);
    if (code == null || !mounted) return;
    context.pushReplacement('/home/family/join/$code');
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(invitePreviewProvider(_code));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Приглашение в семью'),
        bottom: _busy
            ? const PreferredSize(
                preferredSize: Size.fromHeight(2),
                child: LinearProgressIndicator(minHeight: 2),
              )
            : null,
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) {
          final invalid = apiExceptionOf(e)?.code == 'invite_invalid';
          return _Message(
            icon: invalid ? Icons.link_off : Icons.cloud_off_outlined,
            title: invalid ? 'Приглашение не найдено' : 'Не удалось проверить приглашение',
            text: invalid
                ? 'Приглашение не найдено, истекло или уже использовано. Попросите '
                      'владельца семьи прислать новое.'
                : familyErrorMessage(e),
            actionLabel: invalid ? 'Ввести другой код' : 'Повторить',
            onAction: invalid ? _otherCode : () => ref.invalidate(invitePreviewProvider(_code)),
          );
        },
        data: (p) => _PreviewBody(code: _code, preview: p, busy: _busy, onJoin: () => _join(p)),
      ),
    );
  }
}

class _PreviewBody extends StatelessWidget {
  const _PreviewBody({
    required this.code,
    required this.preview,
    required this.busy,
    required this.onJoin,
  });

  final String code;
  final InvitePreview preview;
  final bool busy;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final familyName = preview.familyName.isEmpty ? 'Без названия' : preview.familyName;
    final blocked = preview.blockedText;

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(color: scheme.primaryContainer, shape: BoxShape.circle),
            child: Icon(Icons.family_restroom, size: 48, color: scheme.onPrimaryContainer),
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'Семья «$familyName»',
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        if (preview.invitedBy.isNotEmpty)
          Text(
            'Приглашает: ${preview.invitedBy}',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge,
          ),
        const SizedBox(height: 4),
        Text(
          [
            'Код ${formatInviteCode(code)}',
            if (preview.expiresAt != null) 'действует до ${formatInviteExpiry(preview.expiresAt!)}',
          ].join(' · '),
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        if (blocked == null) ...[
          Text(
            'Вы станете родителем в этой семье: увидите детей, карту и геозоны и будете '
            'получать уведомления.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          _Notice(
            icon: Icons.warning_amber_rounded,
            color: scheme.tertiaryContainer,
            onColor: scheme.onTertiaryContainer,
            text: 'Ваша текущая пустая семья будет удалена.',
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: busy ? null : onJoin,
            icon: const Icon(Icons.group_add_outlined),
            label: const Text('Присоединиться'),
          ),
        ] else ...[
          _Notice(
            icon: Icons.block,
            color: scheme.errorContainer,
            onColor: scheme.onErrorContainer,
            text: blocked,
          ),
          const SizedBox(height: 24),
          OutlinedButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: const Text('Назад'),
          ),
        ],
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.color,
    required this.onColor,
    required this.text,
  });

  final IconData icon;
  final Color color;
  final Color onColor;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: onColor),
          const SizedBox(width: 12),
          Expanded(
            child: Text(text, style: TextStyle(color: onColor)),
          ),
        ],
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.text,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String text;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 32),
        Icon(icon, size: 64, color: scheme.onSurfaceVariant),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(text, textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
        const SizedBox(height: 16),
        Center(
          child: FilledButton.tonal(onPressed: onAction, child: Text(actionLabel)),
        ),
      ],
    );
  }
}
