import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../family/family_models.dart' show validateMemberName;
import 'profile_models.dart';
import 'profile_repository.dart';

/// v0.76.0: профиль — ФИО взрослого (как /cabinet/profile в веб-кабинете).
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Профиль')),
      body: profile.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(profileErrorMessage(e), textAlign: TextAlign.center),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () => ref.invalidate(profileProvider),
                  child: const Text('Повторить'),
                ),
              ],
            ),
          ),
        ),
        data: (data) => _ProfileForm(data: data),
      ),
    );
  }
}

class _ProfileForm extends ConsumerStatefulWidget {
  const _ProfileForm({required this.data});

  final ProfileData data;

  @override
  ConsumerState<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<_ProfileForm> {
  final _formKey = GlobalKey<FormState>();
  late final _lastName = TextEditingController(text: widget.data.name.lastName);
  late final _firstName = TextEditingController(text: widget.data.name.firstName);
  late final _middleName = TextEditingController(text: widget.data.name.middleName);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _lastName.dispose();
    _firstName.dispose();
    _middleName.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final name = await ref
          .read(profileRepositoryProvider)
          .save(
            ProfileName(
              lastName: _lastName.text,
              firstName: _firstName.text,
              middleName: _middleName.text,
            ),
          );
      await saveSessionUserName(ref, name);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Профиль сохранён')));
      context.pop();
    } catch (e) {
      if (mounted) setState(() => _error = profileErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'ФИО видят взрослые вашей семьи — в списке семьи, на карте и в «Найти телефон».',
                style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 20),
              // Как при регистрации: фамилия и имя обязательны, отчество — по желанию.
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
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _submit(),
                decoration: const InputDecoration(labelText: 'Отчество (необязательно)'),
                validator: (v) => validateMemberName(v, required: false),
              ),
              const SizedBox(height: 12),
              TextFormField(
                initialValue: widget.data.email,
                enabled: false,
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: TextStyle(color: scheme.error)),
              ],
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Сохранить'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
