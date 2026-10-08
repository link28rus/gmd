import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../consent/consent_providers.dart';
import '../zones/zones_providers.dart';
import 'family_models.dart';
import 'family_providers.dart';
import 'widgets/create_member_sheets.dart';
import 'widgets/family_dialogs.dart';

/// v0.71.0: экран «Семья» — название, участники, приглашения взрослых,
/// удаление/выход/передача прав, ввод кода приглашения
/// (docs/superpowers/specs/2026-10-08-family-members.md).
class FamilyScreen extends ConsumerStatefulWidget {
  const FamilyScreen({super.key});

  @override
  ConsumerState<FamilyScreen> createState() => _FamilyScreenState();
}

class _FamilyScreenState extends ConsumerState<FamilyScreen> {
  bool _busy = false;

  void _snack(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  /// Выполнить действие с индикатором; ошибку — в SnackBar. true — успех.
  Future<bool> _run(Future<void> Function() action) async {
    if (_busy) return false;
    setState(() => _busy = true);
    try {
      await action();
      return true;
    } catch (e) {
      _snack(familyErrorMessage(e));
      // v0.72.0: роутер откроет экран принятия политики.
      markConsentRequired(ref, e);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reload() async {
    ref.invalidate(familyMembersProvider);
    ref.invalidate(familyInvitesProvider);
    try {
      await ref.read(familyMembersProvider.future);
    } catch (_) {
      // ошибку покажет экран
    }
  }

  Future<void> _rename(FamilyInfo family) async {
    final name = await showRenameFamilyDialog(context, family.name);
    if (name == null || !mounted) return;
    final ok = await _run(() async {
      final updated = await ref.read(familyRepositoryProvider).rename(family.id, name);
      await saveSessionFamily(ref, updated, FamilyRole.owner);
      ref.invalidate(familyMembersProvider);
    });
    if (ok) _snack('Название семьи сохранено');
  }

  Future<void> _invite() async {
    MemberInvite? invite;
    final ok = await _run(() async {
      invite = await ref.read(familyRepositoryProvider).createInvite();
      ref.invalidate(familyInvitesProvider);
    });
    if (!ok || invite == null || !mounted) return;
    await showMemberInviteSheet(context, invite!);
  }

  /// v0.72.0: владелец заводит аккаунт сам (email + пароль), без приглашения.
  Future<void> _createMember() async {
    if (_busy) return;
    final account = await showCreateMemberSheet(
      context,
      onSubmit: ref.read(familyRepositoryProvider).createMember,
    );
    if (account == null || !mounted) return;
    ref.invalidate(familyMembersProvider);
    await showCreatedMemberSheet(context, account);
  }

  Future<void> _revoke(MemberInvite invite) async {
    final confirmed = await confirmFamilyAction(
      context,
      title: 'Отозвать приглашение ${invite.displayCode}?',
      body:
          'Ссылка и код перестанут работать. Если по ним ещё не присоединились — '
          'отправьте новое приглашение.',
      confirmLabel: 'Отозвать',
    );
    if (!confirmed || !mounted) return;
    final ok = await _run(() async {
      await ref.read(familyRepositoryProvider).revokeInvite(invite.id);
      ref.invalidate(familyInvitesProvider);
    });
    if (ok) _snack('Приглашение отозвано');
  }

  Future<void> _remove(FamilyMember m) async {
    final confirmed = await confirmFamilyAction(
      context,
      title: 'Удалить ${m.displayName} из семьи?',
      body:
          '${m.displayName} сразу потеряет доступ к детям, карте, геозонам и '
          'уведомлениям вашей семьи. Для него будет создана новая пустая семья. '
          'Вернуть его можно только новым приглашением.',
      confirmLabel: 'Удалить',
    );
    if (!confirmed || !mounted) return;
    final ok = await _run(() async {
      await ref.read(familyRepositoryProvider).removeMember(m.userId);
      ref.invalidate(familyMembersProvider);
      // Родитель-участник мог быть на общей карте семьи.
      ref.invalidate(familyLatestProvider);
    });
    if (ok) _snack('${m.displayName} удалён(а) из семьи');
  }

  Future<void> _transfer(FamilyInfo family, FamilyMember m) async {
    final confirmed = await confirmFamilyAction(
      context,
      title: 'Сделать ${m.displayName} владельцем?',
      body:
          'Владелец переименовывает семью, приглашает и удаляет взрослых. '
          'Вы станете обычным родителем: дети, карта и уведомления останутся, '
          'но управлять участниками вы больше не сможете. Вернуть права может '
          'только новый владелец.',
      confirmLabel: 'Передать права',
    );
    if (!confirmed || !mounted) return;
    final ok = await _run(() async {
      await ref.read(familyRepositoryProvider).transferOwnership(m.userId);
      await applyMembershipChange(ref, family: family, role: FamilyRole.parent);
    });
    if (ok) _snack('Теперь владелец семьи — ${m.displayName}');
  }

  Future<void> _leave(FamilyInfo family) async {
    final confirmed = await confirmFamilyAction(
      context,
      title: 'Выйти из семьи «${family.name}»?',
      body:
          'Вы сразу потеряете доступ к детям, карте, геозонам и уведомлениям '
          'этой семьи. Для вас будет создана новая пустая семья. Вернуться можно '
          'только по новому приглашению владельца.',
      confirmLabel: 'Выйти',
    );
    if (!confirmed || !mounted) return;
    FamilyInfo? fresh;
    final ok = await _run(() async {
      fresh = await ref.read(familyRepositoryProvider).leave();
      await applyMembershipChange(ref, family: fresh!, role: FamilyRole.owner);
    });
    if (!ok || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    context.go('/home');
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('Вы вышли из семьи «${family.name}»')));
  }

  Future<void> _enterCode() async {
    final code = await showInviteCodeDialog(context);
    if (code == null || !mounted) return;
    await context.push('/home/family/join/$code');
  }

  /// Пока экран открыт, членство могло смениться (владелец удалил из семьи):
  /// сервер отдаёт другую семью, чем в сессии → обновить сессию и кэш.
  void _syncSession(FamilyMembers data) {
    final session = ref.read(authSessionProvider);
    if (session == null) return;
    final sameFamily = session.family.id == data.family.id;
    final sameName = session.family.name == data.family.name;
    final sameRole = session.user.role == data.myRole.name;
    if (sameFamily && sameName && sameRole) return;
    saveSessionFamily(ref, data.family, data.myRole).then((_) {
      if (!sameFamily && mounted) {
        invalidateFamilyData(ref);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AsyncValue<FamilyMembers>>(familyMembersProvider, (_, next) {
      final data = next.valueOrNull;
      if (data != null) _syncSession(data);
    });
    final async = ref.watch(familyMembersProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Семья'),
        bottom: _busy
            ? const PreferredSize(
                preferredSize: Size.fromHeight(2),
                child: LinearProgressIndicator(minHeight: 2),
              )
            : null,
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: async.when(
          loading: () => ListView(
            children: const [
              SizedBox(height: 64),
              Center(child: CircularProgressIndicator()),
            ],
          ),
          error: (e, _) => _ErrorBody(message: familyErrorMessage(e), onRetry: _reload),
          data: (data) => _FamilyBody(
            data: data,
            busy: _busy,
            onRename: () => _rename(data.family),
            onInvite: _invite,
            onCreateMember: _createMember,
            onRevoke: _revoke,
            onRemove: _remove,
            onTransfer: (m) => _transfer(data.family, m),
            onLeave: () => _leave(data.family),
            onEnterCode: _enterCode,
          ),
        ),
      ),
    );
  }
}

class _FamilyBody extends ConsumerWidget {
  const _FamilyBody({
    required this.data,
    required this.busy,
    required this.onRename,
    required this.onInvite,
    required this.onCreateMember,
    required this.onRevoke,
    required this.onRemove,
    required this.onTransfer,
    required this.onLeave,
    required this.onEnterCode,
  });

  final FamilyMembers data;
  final bool busy;
  final VoidCallback onRename;
  final VoidCallback onInvite;
  final VoidCallback onCreateMember;
  final ValueChanged<MemberInvite> onRevoke;
  final ValueChanged<FamilyMember> onRemove;
  final ValueChanged<FamilyMember> onTransfer;
  final VoidCallback onLeave;
  final VoidCallback onEnterCode;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final owner = data.iAmOwner;
    FamilyMember? ownerMember;
    for (final m in data.members) {
      if (m.isOwner) {
        ownerMember = m;
        break;
      }
    }
    final othersCount = data.members.where((m) => !m.isMe).length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        // --- Название ---
        Card(
          elevation: 0,
          color: scheme.primaryContainer,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: ListTile(
            contentPadding: const EdgeInsets.fromLTRB(20, 8, 8, 8),
            leading: Icon(Icons.family_restroom, color: scheme.onPrimaryContainer),
            title: Text(
              data.family.name.isEmpty ? 'Без названия' : data.family.name,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
                color: scheme.onPrimaryContainer,
              ),
            ),
            subtitle: Text(
              owner ? 'Вы — владелец семьи' : 'Вы — родитель в этой семье',
              style: TextStyle(color: scheme.onPrimaryContainer),
            ),
            trailing: owner
                ? IconButton(
                    tooltip: 'Переименовать',
                    icon: Icon(Icons.edit_outlined, color: scheme.onPrimaryContainer),
                    onPressed: busy ? null : onRename,
                  )
                : null,
          ),
        ),
        const SizedBox(height: 24),

        // --- Участники ---
        _SectionTitle('Взрослые (${data.members.length})'),
        for (final m in data.members)
          _MemberTile(
            member: m,
            canManage: owner && !m.isMe && !busy,
            onRemove: () => onRemove(m),
            onTransfer: () => onTransfer(m),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
          child: Text(
            owner
                ? (othersCount > 0
                      ? 'Все взрослые видят детей, карту и геозоны и получают уведомления. '
                            'Чтобы выйти из семьи самому, сначала передайте права владельца.'
                      : 'Пригласите второго родителя или другого взрослого — он увидит '
                            'детей, карту и геозоны и будет получать уведомления.')
                : 'Приглашать и удалять взрослых может только владелец'
                      '${ownerMember != null ? ' — ${ownerMember.displayName}' : ''}.',
            style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),

        // --- Добавить взрослого и приглашения (владелец) ---
        // v0.72.0: два способа — по ссылке (человек регистрируется сам) и
        // «Создать аккаунт» (email и пароль задаёт владелец).
        if (owner) ...[
          const SizedBox(height: 24),
          _SectionTitle('Добавить взрослого'),
          FilledButton.icon(
            onPressed: busy ? null : onInvite,
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('Пригласить по ссылке'),
          ),
          _Hint(
            'Человек сам зарегистрируется (или войдёт в свой аккаунт) и примет '
            'приглашение. Подходит, если у него уже есть Перископ.',
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: busy ? null : onCreateMember,
            icon: const Icon(Icons.manage_accounts_outlined),
            label: const Text('Создать аккаунт'),
          ),
          _Hint(
            'Вы задаёте email и пароль и сами передаёте их человеку — регистрироваться '
            'ему не нужно.',
          ),
          const SizedBox(height: 24),
          _SectionTitle('Приглашения'),
          _InvitesList(onRevoke: onRevoke, busy: busy),
        ],

        const SizedBox(height: 24),
        OutlinedButton.icon(
          onPressed: busy ? null : onEnterCode,
          icon: const Icon(Icons.vpn_key_outlined),
          label: const Text('Ввести код приглашения'),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 6, 4, 0),
          child: Text(
            'Если вас пригласили в другую семью. Перейти можно, только если в вашей '
            'текущей семье нет детей и других взрослых.',
            style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),

        // --- Выход (не владелец) ---
        if (!owner) ...[
          const SizedBox(height: 24),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: scheme.error,
              side: BorderSide(color: scheme.error),
            ),
            onPressed: busy ? null : onLeave,
            icon: const Icon(Icons.logout),
            label: const Text('Выйти из семьи'),
          ),
        ],
      ],
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 6, 4, 0),
      child: Text(
        text,
        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        text,
        style: theme.textTheme.titleSmall?.copyWith(
          fontWeight: FontWeight.w600,
          color: theme.colorScheme.primary,
        ),
      ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({
    required this.member,
    required this.canManage,
    required this.onRemove,
    required this.onTransfer,
  });

  final FamilyMember member;
  final bool canManage;
  final VoidCallback onRemove;
  final VoidCallback onTransfer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final name = member.displayName.isEmpty ? member.email : member.displayName;
    final initial = name.isEmpty ? '?' : name.characters.first.toUpperCase();
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: member.isOwner
              ? scheme.primaryContainer
              : scheme.surfaceContainerHighest,
          foregroundColor: member.isOwner ? scheme.onPrimaryContainer : scheme.onSurfaceVariant,
          child: Text(initial, style: const TextStyle(fontWeight: FontWeight.w600)),
        ),
        title: Text.rich(
          TextSpan(
            text: name,
            style: const TextStyle(fontWeight: FontWeight.w600),
            children: [
              if (member.isMe)
                TextSpan(
                  text: '  · Вы',
                  style: TextStyle(fontWeight: FontWeight.w400, color: scheme.primary),
                ),
            ],
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (member.email.isNotEmpty && member.email != name) Text(member.email),
            Text(
              member.role.label,
              style: TextStyle(
                color: member.isOwner ? scheme.primary : scheme.onSurfaceVariant,
                fontWeight: member.isOwner ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
        trailing: canManage
            ? PopupMenuButton<String>(
                tooltip: 'Действия',
                onSelected: (v) {
                  if (v == 'owner') onTransfer();
                  if (v == 'remove') onRemove();
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(
                    value: 'owner',
                    child: Row(
                      children: [
                        Icon(Icons.workspace_premium_outlined, size: 20),
                        SizedBox(width: 12),
                        Text('Сделать владельцем'),
                      ],
                    ),
                  ),
                  PopupMenuItem(
                    value: 'remove',
                    child: Row(
                      children: [
                        Icon(Icons.person_remove_outlined, size: 20, color: scheme.error),
                        const SizedBox(width: 12),
                        Text('Удалить из семьи', style: TextStyle(color: scheme.error)),
                      ],
                    ),
                  ),
                ],
              )
            : null,
      ),
    );
  }
}

class _InvitesList extends ConsumerWidget {
  const _InvitesList({required this.onRevoke, required this.busy});

  final ValueChanged<MemberInvite> onRevoke;
  final bool busy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final async = ref.watch(familyInvitesProvider);
    return async.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(12),
        child: Center(
          child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      ),
      error: (e, _) => Padding(
        padding: const EdgeInsets.all(8),
        child: Text(
          'Не удалось загрузить приглашения: ${familyErrorMessage(e)}',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.error),
        ),
      ),
      data: (invites) {
        if (invites.isEmpty) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(4, 4, 4, 0),
            child: Text(
              'Активных приглашений нет. Приглашение одноразовое и действует 7 дней.',
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          );
        }
        return Column(
          children: [
            for (final inv in invites)
              Card(
                elevation: 0,
                margin: const EdgeInsets.only(bottom: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: BorderSide(color: scheme.outlineVariant),
                ),
                child: ListTile(
                  leading: const Icon(Icons.link),
                  title: Text(
                    inv.displayCode,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.5,
                    ),
                  ),
                  subtitle: Text('Действует до ${formatInviteExpiry(inv.expiresAt)}'),
                  onTap: () => showMemberInviteSheet(context, inv),
                  trailing: TextButton(
                    onPressed: busy ? null : () => onRevoke(inv),
                    child: const Text('Отозвать'),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _ErrorBody extends StatelessWidget {
  const _ErrorBody({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 32),
        Icon(Icons.cloud_off_outlined, size: 64, color: scheme.onSurfaceVariant),
        const SizedBox(height: 16),
        Text(
          'Не удалось загрузить семью',
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(
          message,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        Center(
          child: FilledButton.tonal(onPressed: onRetry, child: const Text('Повторить')),
        ),
      ],
    );
  }
}
