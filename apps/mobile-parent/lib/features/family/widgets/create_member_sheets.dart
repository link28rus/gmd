import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../family_models.dart';

/// v0.72.0: владелец создаёт аккаунт участнику — форма и лист с данными для
/// входа (docs/superpowers/specs/2026-10-08-family-members.md, раздел «v0.72.0»).

/// Отправка формы: создать аккаунт на сервере, вернуть участника.
typedef CreateMemberSubmit =
    Future<FamilyMember> Function({
      required String email,
      required String lastName,
      required String firstName,
      String? middleName,
      required String password,
    });

/// Bottom sheet с формой «Создать аккаунт». Ошибки сервера показывает внутри
/// формы. Возвращает созданный аккаунт с паролем или null (отмена).
Future<CreatedMemberAccount?> showCreateMemberSheet(
  BuildContext context, {
  required CreateMemberSubmit onSubmit,
}) {
  return showModalBottomSheet<CreatedMemberAccount>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _CreateMemberSheet(onSubmit: onSubmit),
  );
}

class _CreateMemberSheet extends StatefulWidget {
  const _CreateMemberSheet({required this.onSubmit});

  final CreateMemberSubmit onSubmit;

  @override
  State<_CreateMemberSheet> createState() => _CreateMemberSheetState();
}

class _CreateMemberSheetState extends State<_CreateMemberSheet> {
  final _formKey = GlobalKey<FormState>();
  final _lastName = TextEditingController();
  final _firstName = TextEditingController();
  final _middleName = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _lastName.dispose();
    _firstName.dispose();
    _middleName.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _generate() {
    setState(() {
      _password.text = generateMemberPassword();
      _obscure = false;
    });
  }

  Future<void> _submit() async {
    if (_busy || !_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final email = _email.text.trim().toLowerCase();
    final password = _password.text;
    try {
      final member = await widget.onSubmit(
        email: email,
        lastName: _lastName.text.trim(),
        firstName: _firstName.text.trim(),
        middleName: _middleName.text.trim(),
        password: password,
      );
      if (!mounted) return;
      Navigator.of(
        context,
      ).pop(CreatedMemberAccount(member: member, email: email, password: password));
    } catch (e) {
      if (mounted) setState(() => _error = createMemberErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Создать аккаунт',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                Text(
                  'Вы задаёте email и пароль и сами передаёте их человеку. Он сразу '
                  'станет родителем в вашей семье: увидит детей, карту, геозоны и будет '
                  'получать уведомления. Пароль он сможет сменить сам.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 20),
                // ФИО как при регистрации: фамилия и имя обязательны, отчество — по желанию.
                TextFormField(
                  controller: _lastName,
                  enabled: !_busy,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Фамилия'),
                  validator: (v) =>
                      validateMemberName(v, required: true, emptyMessage: 'Введите фамилию'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _firstName,
                  enabled: !_busy,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Имя'),
                  validator: (v) => validateMemberName(v, required: true),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _middleName,
                  enabled: !_busy,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Отчество (необязательно)'),
                  validator: (v) => validateMemberName(v, required: false),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _email,
                  enabled: !_busy,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  enableSuggestions: false,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Email'),
                  validator: validateMemberEmail,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  enabled: !_busy,
                  obscureText: _obscure,
                  autocorrect: false,
                  enableSuggestions: false,
                  textInputAction: TextInputAction.done,
                  style: _obscure ? null : const TextStyle(fontFamily: 'monospace'),
                  decoration: InputDecoration(
                    labelText: 'Пароль',
                    helperText: 'Не короче $memberPasswordMin символов',
                    suffixIcon: IconButton(
                      tooltip: _obscure ? 'Показать пароль' : 'Скрыть пароль',
                      icon: Icon(
                        _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                      ),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: validateMemberPassword,
                  onFieldSubmitted: (_) => _submit(),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _busy ? null : _generate,
                    icon: const Icon(Icons.auto_fix_high_outlined, size: 18),
                    label: const Text('Сгенерировать'),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(color: scheme.error),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Создать аккаунт'),
                ),
                const SizedBox(height: 4),
                TextButton(
                  onPressed: _busy ? null : () => Navigator.of(context).pop(),
                  child: const Text('Отмена'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet «Аккаунт создан»: email и пароль (показываются один раз),
/// «Поделиться» и «Копировать». Закрывается только кнопкой «Готово» — чтобы
/// пароль не потерялся случайным смахиванием.
Future<void> showCreatedMemberSheet(BuildContext context, CreatedMemberAccount account) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    builder: (_) => _CreatedMemberSheet(account: account),
  );
}

class _CreatedMemberSheet extends StatefulWidget {
  const _CreatedMemberSheet({required this.account});

  final CreatedMemberAccount account;

  @override
  State<_CreatedMemberSheet> createState() => _CreatedMemberSheetState();
}

class _CreatedMemberSheetState extends State<_CreatedMemberSheet> {
  // SnackBar под модальным листом не виден — подтверждаем копирование на кнопке.
  bool _copied = false;

  CreatedMemberAccount get account => widget.account;

  Future<void> _share(BuildContext btnContext) async {
    // iPad: системный лист нужно привязать к кнопке.
    final box = btnContext.findRenderObject() as RenderBox?;
    final origin = box == null ? null : box.localToGlobal(Offset.zero) & box.size;
    try {
      await SharePlus.instance.share(
        ShareParams(
          text: account.shareText,
          subject: 'Вход в Перископ',
          sharePositionOrigin: origin,
        ),
      );
    } catch (_) {
      // Нет обработчика «Поделиться» — хотя бы в буфер обмена.
      await _copy();
    }
  }

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: account.shareText));
    if (mounted) setState(() => _copied = true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final name = account.member.displayName;
    final mono = theme.textTheme.titleMedium?.copyWith(
      fontFamily: 'monospace',
      fontWeight: FontWeight.w600,
      color: scheme.onPrimaryContainer,
    );
    final label = theme.textTheme.bodySmall?.copyWith(color: scheme.onPrimaryContainer);
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.check_circle_outline, size: 48, color: scheme.primary),
            const SizedBox(height: 8),
            Text(
              'Аккаунт создан',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
            ),
            if (name.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                '$name теперь в вашей семье.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Email', style: label),
                  SelectableText(account.email, style: mono),
                  const SizedBox(height: 12),
                  Text('Пароль', style: label),
                  SelectableText(account.password, style: mono),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.warning_amber_rounded, size: 20, color: scheme.error),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Пароль больше не будет показан — отправьте или сохраните его сейчас. '
                    'Политику конфиденциальности человек примет при первом входе.',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              ],
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
            const SizedBox(height: 8),
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Готово')),
          ],
        ),
      ),
    );
  }
}
