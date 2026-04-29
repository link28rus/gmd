import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers.dart';

/// Регистрация. После успеха показываем «Письмо отправлено» — подтверждение
/// идёт по ссылке из email (открывается в браузере → backend → /login).
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _lastName = TextEditingController();
  final _firstName = TextEditingController();
  final _middleName = TextEditingController();
  final _familyName = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _passwordConfirm = TextEditingController();

  bool _loading = false;
  String? _error;
  bool _sent = false;

  @override
  void dispose() {
    _lastName.dispose();
    _firstName.dispose();
    _middleName.dispose();
    _familyName.dispose();
    _email.dispose();
    _password.dispose();
    _passwordConfirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).register(
            email: _email.text.trim(),
            password: _password.text,
            passwordConfirm: _passwordConfirm.text,
            firstName: _firstName.text.trim(),
            lastName: _lastName.text.trim(),
            middleName: _middleName.text.trim(),
            familyName: _familyName.text.trim(),
          );
      if (mounted) setState(() => _sent = true);
    } on ApiException catch (e) {
      String msg;
      if (e.code == 'email_taken_verified') {
        msg = 'Этот email уже зарегистрирован';
      } else if (e.isRateLimited) {
        msg = 'Слишком много попыток, подождите минуту';
      } else {
        msg = e.message ?? 'Не удалось зарегистрироваться';
      }
      setState(() => _error = msg);
    } catch (_) {
      setState(() => _error = 'Не удалось соединиться с сервером');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Регистрация')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _sent ? _buildSuccess() : _buildForm(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSuccess() {
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(Icons.mark_email_read_outlined,
                size: 64, color: Colors.green.shade600),
            const SizedBox(height: 16),
            const Text(
              'Письмо отправлено',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              'Мы отправили ссылку для подтверждения на ${_email.text.trim()}. '
              'Откройте письмо и перейдите по ссылке, после этого вернитесь и войдите.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade700),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => context.go('/login'),
              child: const Text('Перейти ко входу'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Card(
        elevation: 0,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _field(_lastName, 'Фамилия', required: true),
              _field(_firstName, 'Имя', required: true),
              _field(_middleName, 'Отчество (необязательно)'),
              _field(_familyName, 'Название семьи (необязательно)'),
              _field(_email, 'Email',
                  keyboardType: TextInputType.emailAddress, required: true,
                  email: true),
              _field(_password, 'Пароль',
                  obscure: true, required: true, minLength: 8),
              _field(_passwordConfirm, 'Повторите пароль',
                  obscure: true, required: true,
                  matchController: _password),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: Text(_loading ? 'Регистрируем…' : 'Зарегистрироваться'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Colors.red.shade700)),
              ],
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => context.go('/login'),
                child: const Text('Уже есть аккаунт? Войти'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = false,
    bool obscure = false,
    TextInputType? keyboardType,
    bool email = false,
    int? minLength,
    TextEditingController? matchController,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        obscureText: obscure,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
        validator: (value) {
          final v = value?.trim() ?? '';
          if (required && v.isEmpty) return 'Заполните поле';
          if (email && v.isNotEmpty && !v.contains('@')) {
            return 'Некорректный email';
          }
          if (minLength != null && (value?.length ?? 0) < minLength) {
            return 'Минимум $minLength символов';
          }
          if (matchController != null && value != matchController.text) {
            return 'Пароли не совпадают';
          }
          return null;
        },
      ),
    );
  }
}
