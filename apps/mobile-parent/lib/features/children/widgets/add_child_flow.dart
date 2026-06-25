import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/api/api_exception.dart';
import '../child_models.dart';
import '../children_providers.dart';

/// Two-step flow «Добавить ребёнка»:
///
/// 1. [showCreateChildSheet] — форма (имя + дата рождения опционально).
///    POST /family/children → возвращает childId.
/// 2. [showInviteQrSheet] — генерирует invite (POST /family/children/:id/invites)
///    и показывает QR-код для сканирования mobile-child. Для детей 14+
///    требует чекбокс согласия на обработку геолокации (152-ФЗ).
///
/// Оба шага — modalBottomSheet. После успеха инвалидируется
/// `childrenListProvider`, чтобы новый ребёнок появился в HomeScreen.
Future<void> startAddChildFlow(BuildContext context, WidgetRef ref) async {
  final created = await showModalBottomSheet<({String childId, String name, DateTime? dob})>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _CreateChildSheet(),
  );
  if (created == null || !context.mounted) return;
  ref.invalidate(childrenListProvider);
  await showInviteQrSheet(
    context,
    ref,
    childId: created.childId,
    childName: created.name,
    dateOfBirth: created.dob,
  );
}

/// Открывает только QR-шит — для существующего ребёнка (например, повторная
/// привязка после `reset-device`). Публичный API, может вызываться из других
/// мест. На v0.47 не используется, заложено на будущее.
Future<void> showInviteQrSheet(
  BuildContext context,
  WidgetRef ref, {
  required String childId,
  required String childName,
  DateTime? dateOfBirth,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _InviteQrSheet(
      childId: childId,
      childName: childName,
      dateOfBirth: dateOfBirth,
    ),
  );
}

// ─── Step 1: Create child ───────────────────────────────────────────────

class _CreateChildSheet extends ConsumerStatefulWidget {
  const _CreateChildSheet();

  @override
  ConsumerState<_CreateChildSheet> createState() => _CreateChildSheetState();
}

class _CreateChildSheetState extends ConsumerState<_CreateChildSheet> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtl = TextEditingController();
  DateTime? _dob;
  bool _saving = false;

  @override
  void dispose() {
    _nameCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mq = MediaQuery.of(context);
    // viewInsets.bottom — клавиатура, padding.bottom — системный nav-bar
    // (gesture/3-button). Берём максимум, чтобы кнопки не залезали ни под
    // клавиатуру, ни под системный бар.
    final safeBottom = mq.viewInsets.bottom > 0
        ? mq.viewInsets.bottom
        : mq.padding.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + safeBottom),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Новый ребёнок',
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              'Заполните имя. Дата рождения нужна, чтобы корректно запросить '
              'согласие 14+ при привязке устройства.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _nameCtl,
              autofocus: true,
              maxLength: 120,
              textInputAction: TextInputAction.done,
              inputFormatters: [
                FilteringTextInputFormatter.deny(RegExp(r'[\r\n\t]')),
              ],
              decoration: const InputDecoration(
                labelText: 'Имя',
                hintText: 'Например, Степан',
                border: OutlineInputBorder(),
              ),
              validator: (v) {
                final t = v?.trim() ?? '';
                if (t.isEmpty) return 'Укажите имя';
                if (t.length > 120) return 'Слишком длинное имя';
                return null;
              },
              onFieldSubmitted: (_) => _saving ? null : _submit(),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _saving ? null : _pickDob,
              borderRadius: BorderRadius.circular(4),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Дата рождения (опционально)',
                  border: OutlineInputBorder(),
                  suffixIcon: Icon(Icons.calendar_today_outlined),
                ),
                child: Text(
                  _dob == null ? 'Не указана' : _formatDate(_dob!),
                  style: theme.textTheme.bodyLarge,
                ),
              ),
            ),
            if (_dob != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _saving ? null : () => setState(() => _dob = null),
                  icon: const Icon(Icons.clear, size: 16),
                  label: const Text('Очистить дату'),
                ),
              ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed:
                      _saving ? null : () => Navigator.of(context).maybePop(),
                  child: const Text('Отмена'),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: _saving ? null : _submit,
                  icon: _saving
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  label: Text(_saving ? 'Сохраняем…' : 'Создать'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 8, now.month, now.day),
      firstDate: DateTime(now.year - 25),
      lastDate: now,
      helpText: 'Дата рождения',
      locale: const Locale('ru'),
    );
    if (picked != null && mounted) {
      setState(() => _dob = picked);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final name = _nameCtl.text.trim();
    setState(() => _saving = true);
    try {
      final id = await ref.read(childrenRepositoryProvider).createChild(
            name: name,
            dateOfBirth: _dob,
          );
      if (!mounted) return;
      Navigator.of(context).pop((childId: id, name: name, dob: _dob));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: Colors.red.shade700,
          content: Text(_createErrorText(e)),
        ),
      );
      setState(() => _saving = false);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: Colors.red.shade700,
          content: Text('Не удалось создать: $e'),
        ),
      );
      setState(() => _saving = false);
    }
  }

  String _createErrorText(ApiException e) {
    switch (e.code) {
      case 'child_limit_reached':
        return 'Достигнут лимит детей в семье.';
      case 'consent_required':
        return 'Сначала примите согласие на использование сервиса.';
      default:
        return e.message ?? 'Не удалось создать (код ${e.status}).';
    }
  }
}

// ─── Step 2: Show invite QR ─────────────────────────────────────────────

class _InviteQrSheet extends ConsumerStatefulWidget {
  const _InviteQrSheet({
    required this.childId,
    required this.childName,
    required this.dateOfBirth,
  });

  final String childId;
  final String childName;
  final DateTime? dateOfBirth;

  @override
  ConsumerState<_InviteQrSheet> createState() => _InviteQrSheetState();
}

class _InviteQrSheetState extends ConsumerState<_InviteQrSheet> {
  InviteResponse? _invite;
  DateTime? _expiresAt;
  Timer? _ticker;
  Duration _remaining = Duration.zero;
  bool _generating = false;
  String? _error;
  bool _consentGranted = false;

  /// Возраст ребёнка по dateOfBirth — определяет, нужно ли согласие 14+.
  /// null если дата не задана: тогда согласие тоже не требуется (backend
  /// при claim попросит, если ребёнок окажется 14+ — это сейчас вне сценария
  /// MVP и обрабатывается отдельно).
  int? get _ageYears {
    final dob = widget.dateOfBirth;
    if (dob == null) return null;
    final now = DateTime.now();
    var age = now.year - dob.year;
    final m = now.month - dob.month;
    if (m < 0 || (m == 0 && now.day < dob.day)) age--;
    return age;
  }

  bool get _needsConsent {
    final a = _ageYears;
    return a != null && a >= 14;
  }

  @override
  void initState() {
    super.initState();
    if (!_needsConsent) {
      // Автогенерация — обычный сценарий, ребёнок <14 или dob не задан.
      WidgetsBinding.instance.addPostFrameCallback((_) => _generate());
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _generate() async {
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final r = await ref.read(childrenRepositoryProvider).createInvite(
            widget.childId,
            consent14PlusGranted: _needsConsent ? _consentGranted : false,
          );
      if (!mounted) return;
      _ticker?.cancel();
      _expiresAt = r.expiresAt;
      _remaining = Duration(seconds: r.expiresIn);
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        final exp = _expiresAt;
        if (exp == null) return;
        final left = exp.difference(DateTime.now());
        if (!mounted) return;
        setState(() => _remaining = left.isNegative ? Duration.zero : left);
      });
      setState(() {
        _invite = r;
        _generating = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _generating = false;
        _error = _inviteErrorText(e);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _generating = false;
        _error = 'Не удалось создать код: $e';
      });
    }
  }

  String _inviteErrorText(ApiException e) {
    if (e.isRateLimited) {
      return 'Слишком частые запросы кода. Попробуйте через минуту.';
    }
    switch (e.code) {
      case 'child_not_found':
        return 'Ребёнок не найден — возможно был удалён.';
      case 'consent_required':
        return 'Сначала примите согласие на использование сервиса.';
      default:
        return e.message ?? 'Не удалось создать код (${e.status}).';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final safeBottom = MediaQuery.of(context).padding.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + safeBottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Привязка устройства — ${widget.childName}',
            style: theme.textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 4),
          Text(
            'Откройте на телефоне ребёнка приложение «Перископ Ребёнка» '
            'и отсканируйте QR.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
          if (_needsConsent && _invite == null) ...[
            const SizedBox(height: 16),
            _Consent14PlusBlock(
              age: _ageYears!,
              checked: _consentGranted,
              onChanged: (v) => setState(() => _consentGranted = v),
            ),
          ],
          const SizedBox(height: 16),
          _buildBody(theme),
          const SizedBox(height: 16),
          Row(
            children: [
              if (_invite != null || _error != null) ...[
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _generating ||
                            (_needsConsent && !_consentGranted && _invite == null)
                        ? null
                        : _generate,
                    icon: const Icon(Icons.refresh),
                    label: Text(_remaining == Duration.zero
                        ? 'Обновить код'
                        : 'Новый код'),
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: FilledButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Text('Готово'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Text(
          _error!,
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.red.shade700),
        ),
      );
    }
    if (_generating && _invite == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 32),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final invite = _invite;
    if (invite == null) {
      // _needsConsent && не нажат «Создать код» — кнопка-генератор
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: FilledButton.icon(
          onPressed: _consentGranted ? _generate : null,
          icon: const Icon(Icons.qr_code_2),
          label: const Text('Создать код привязки'),
        ),
      );
    }
    final expired = _remaining == Duration.zero;
    return Column(
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.colorScheme.outlineVariant),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: ColorFiltered(
              colorFilter: expired
                  ? const ColorFilter.matrix(<double>[
                      0.33, 0.33, 0.33, 0, 0,
                      0.33, 0.33, 0.33, 0, 0,
                      0.33, 0.33, 0.33, 0, 0,
                      0, 0, 0, 1, 0,
                    ])
                  : const ColorFilter.mode(
                      Colors.transparent, BlendMode.dst),
              child: QrImageView(
                data: invite.qrUrl,
                size: 240,
                backgroundColor: Colors.white,
                eyeStyle: const QrEyeStyle(
                  eyeShape: QrEyeShape.square,
                  color: Colors.black,
                ),
                dataModuleStyle: const QrDataModuleStyle(
                  dataModuleShape: QrDataModuleShape.square,
                  color: Colors.black,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          _formatCode(invite.code),
          style: theme.textTheme.headlineSmall?.copyWith(
            fontFamily: 'monospace',
            letterSpacing: 4,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          expired
              ? 'Код истёк — обновите'
              : 'Действителен ещё ${_formatDuration(_remaining)}',
          style: theme.textTheme.bodySmall?.copyWith(
            color: expired
                ? Colors.red.shade700
                : theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _Consent14PlusBlock extends StatelessWidget {
  const _Consent14PlusBlock({
    required this.age,
    required this.checked,
    required this.onChanged,
  });

  final int age;
  final bool checked;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.amber.shade300),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Ребёнку $age лет.',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: Colors.amber.shade900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'По 152-ФЗ для обработки геолокации ребёнка от 14 лет требуется '
            'его согласие.',
            style: TextStyle(color: Colors.amber.shade900, fontSize: 13),
          ),
          const SizedBox(height: 8),
          InkWell(
            onTap: () => onChanged(!checked),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Checkbox(
                  value: checked,
                  onChanged: (v) => onChanged(v ?? false),
                  visualDensity: VisualDensity.compact,
                ),
                const Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: Text(
                      'Я получил согласие ребёнка на обработку его геолокации.',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _formatDate(DateTime d) {
  final dd = d.day.toString().padLeft(2, '0');
  final mm = d.month.toString().padLeft(2, '0');
  return '$dd.$mm.${d.year}';
}

String _formatDuration(Duration d) {
  final m = d.inMinutes;
  final s = d.inSeconds % 60;
  if (m > 0) return '$m мин ${s.toString().padLeft(2, '0')} сек';
  return '$s сек';
}

String _formatCode(String code) {
  // 6-символьный код — разбиваем как «AB 12 CD» для читабельности.
  final buf = StringBuffer();
  for (var i = 0; i < code.length; i++) {
    if (i > 0 && i % 2 == 0) buf.write(' ');
    buf.write(code[i]);
  }
  return buf.toString();
}
