import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../family_models.dart';

/// Подтверждение действия с последствиями. [destructive] — красная кнопка.
Future<bool> confirmFamilyAction(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,
  bool destructive = true,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) {
      final scheme = Theme.of(ctx).colorScheme;
      return AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Отмена')),
          FilledButton(
            style: destructive
                ? FilledButton.styleFrom(
                    backgroundColor: scheme.error,
                    foregroundColor: scheme.onError,
                  )
                : null,
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      );
    },
  );
  return ok == true;
}

/// Диалог переименования семьи. Возвращает новое имя или null (отмена/без изменений).
Future<String?> showRenameFamilyDialog(BuildContext context, String current) {
  return showDialog<String>(
    context: context,
    builder: (_) => _RenameDialog(current: current),
  );
}

class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.current});

  final String current;

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final TextEditingController _ctl = TextEditingController(text: widget.current);
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    final name = _ctl.text.trim();
    Navigator.of(context).pop(name == widget.current.trim() ? null : name);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Название семьи'),
      content: Form(
        key: _formKey,
        child: TextFormField(
          controller: _ctl,
          autofocus: true,
          maxLength: 120,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(hintText: 'Например, Ивановы'),
          validator: (v) => (v ?? '').trim().isEmpty ? 'Введите название' : null,
          onFieldSubmitted: (_) => _submit(),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Отмена')),
        FilledButton(onPressed: _submit, child: const Text('Сохранить')),
      ],
    );
  }
}

/// Диалог ввода кода приглашения. Возвращает нормализованный код (8 символов)
/// или null.
Future<String?> showInviteCodeDialog(BuildContext context) {
  return showDialog<String>(context: context, builder: (_) => const _CodeDialog());
}

class _CodeDialog extends StatefulWidget {
  const _CodeDialog();

  @override
  State<_CodeDialog> createState() => _CodeDialogState();
}

class _CodeDialogState extends State<_CodeDialog> {
  final _ctl = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(normalizeInviteCode(_ctl.text));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Код приглашения'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Введите код из приглашения — 8 символов, например ABCD-EFGH. '
              'Если пришла ссылка, код — её последняя часть после /join/.',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _ctl,
              autofocus: true,
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              enableSuggestions: false,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9A-Za-z\- ]')),
                LengthLimitingTextInputFormatter(12),
                _UpperCaseFormatter(),
              ],
              style: const TextStyle(fontSize: 20, letterSpacing: 2, fontFamily: 'monospace'),
              decoration: const InputDecoration(hintText: 'ABCD-EFGH'),
              validator: (v) => isValidInviteCode(v ?? '') ? null : 'Код — 8 латинских букв и цифр',
              onFieldSubmitted: (_) => _submit(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Отмена')),
        FilledButton(onPressed: _submit, child: const Text('Далее')),
      ],
    );
  }
}

class _UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) =>
      newValue.copyWith(text: newValue.text.toUpperCase());
}

/// Bottom sheet с приглашением: крупный код, ссылка, срок, «Поделиться» и «Копировать».
Future<void> showMemberInviteSheet(BuildContext context, MemberInvite invite) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _InviteSheet(invite: invite),
  );
}

class _InviteSheet extends StatefulWidget {
  const _InviteSheet({required this.invite});

  final MemberInvite invite;

  @override
  State<_InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends State<_InviteSheet> {
  // SnackBar под модальным листом не виден — подтверждаем копирование на кнопке.
  bool _copied = false;

  MemberInvite get invite => widget.invite;

  Future<void> _share(BuildContext btnContext) async {
    // iPad: системный лист нужно привязать к кнопке.
    final box = btnContext.findRenderObject() as RenderBox?;
    final origin = box == null ? null : box.localToGlobal(Offset.zero) & box.size;
    try {
      await SharePlus.instance.share(
        ShareParams(
          text: invite.shareText,
          subject: 'Приглашение в семью в Перископе',
          sharePositionOrigin: origin,
        ),
      );
    } catch (_) {
      // Нет обработчика «Поделиться» — хотя бы в буфер обмена.
      await _copy();
    }
  }

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: invite.shareText));
    if (mounted) setState(() => _copied = true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Приглашение в семью',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              'Отправьте ссылку взрослому, которого хотите добавить. Он откроет её '
              'или введёт код в приложении «Перископ Родителя» → меню → «Семья» → '
              '«Ввести код приглашения». Он станет родителем: увидит детей, карту, '
              'геозоны и будет получать уведомления.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 16),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(16),
              ),
              child: SelectableText(
                invite.displayCode,
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineLarge?.copyWith(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w700,
                  letterSpacing: 4,
                  color: scheme.onPrimaryContainer,
                ),
              ),
            ),
            const SizedBox(height: 12),
            SelectableText(
              invite.url,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: scheme.primary),
            ),
            const SizedBox(height: 8),
            Text(
              'Действует до ${formatInviteExpiry(invite.expiresAt)}, одноразовое.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _copy,
                    icon: Icon(_copied ? Icons.check : Icons.copy_outlined),
                    label: Text(_copied ? 'Скопировано' : 'Копировать'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Builder(
                    builder: (btnCtx) => FilledButton.icon(
                      onPressed: () => _share(btnCtx),
                      icon: const Icon(Icons.share_outlined),
                      label: const Text('Поделиться'),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
