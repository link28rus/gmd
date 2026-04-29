import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers.dart';

/// Вход. Два режима — OTP-код из письма и пароль (как в web /login).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Mode { otp, password }

enum _Stage { email, otp }

class _LoginScreenState extends ConsumerState<LoginScreen> {
  _Mode _mode = _Mode.otp;
  _Stage _stage = _Stage.email;

  final _emailCtl = TextEditingController();
  final _codeCtl = TextEditingController();
  final _passwordCtl = TextEditingController();

  bool _loading = false;
  String? _error;
  bool _showRegisterCta = false;

  @override
  void dispose() {
    _emailCtl.dispose();
    _codeCtl.dispose();
    _passwordCtl.dispose();
    super.dispose();
  }

  void _switchMode(_Mode next) {
    setState(() {
      _mode = next;
      _stage = _Stage.email;
      _error = null;
      _showRegisterCta = false;
      _codeCtl.clear();
      _passwordCtl.clear();
    });
  }

  Future<void> _requestOtp() async {
    setState(() {
      _loading = true;
      _error = null;
      _showRegisterCta = false;
    });
    try {
      await ref.read(authRepositoryProvider).requestOtp(_emailCtl.text.trim());
      if (mounted) setState(() => _stage = _Stage.otp);
    } on ApiException catch (e) {
      _handleAuthError(e, isRegisterFlow: true);
    } catch (_) {
      setState(() => _error = 'Не удалось соединиться с сервером');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyOtp() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final session = await ref.read(authRepositoryProvider).verifyOtp(
            email: _emailCtl.text.trim(),
            code: _codeCtl.text.trim(),
          );
      ref.read(authSessionProvider.notifier).state = session;
      // FCM регистрируем fire-and-forget — не блокируем переход на /home.
      unawaited(ref.read(parentFcmRegistrarProvider).register());
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      _handleAuthError(e);
    } catch (_) {
      setState(() => _error = 'Не удалось соединиться с сервером');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loginWithPassword() async {
    setState(() {
      _loading = true;
      _error = null;
      _showRegisterCta = false;
    });
    try {
      final session = await ref.read(authRepositoryProvider).loginWithPassword(
            email: _emailCtl.text.trim(),
            password: _passwordCtl.text,
          );
      ref.read(authSessionProvider.notifier).state = session;
      unawaited(ref.read(parentFcmRegistrarProvider).register());
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      _handleAuthError(e);
    } catch (_) {
      setState(() => _error = 'Не удалось соединиться с сервером');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _handleAuthError(ApiException e, {bool isRegisterFlow = false}) {
    String msg;
    bool cta = false;
    switch (e.code) {
      case 'user_not_found':
        msg = 'Пользователь с такой почтой не найден';
        cta = true;
        break;
      case 'email_not_verified':
        msg = 'Почта не подтверждена. Проверьте письмо';
        cta = true;
        break;
      case 'account_blocked':
        msg = 'Аккаунт заблокирован. Обратитесь к администратору';
        break;
      case 'invalid_code':
      case 'code_expired':
      case 'code_consumed':
        msg = 'Неверный код';
        break;
      case 'invalid_credentials':
        msg = 'Неверный email или пароль';
        break;
      case 'account_locked':
        msg = 'Аккаунт временно заблокирован, попробуйте позже';
        break;
      default:
        if (e.isRateLimited) {
          msg = 'Слишком много попыток, подождите минуту';
        } else {
          msg = e.message ?? 'Не удалось войти';
        }
    }
    setState(() {
      _error = msg;
      _showRegisterCta = cta;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Вход в GMD',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Родительский контроль и геолокация',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                      ),
                      const SizedBox(height: 24),
                      SegmentedButton<_Mode>(
                        segments: const [
                          ButtonSegment(value: _Mode.otp, label: Text('По коду')),
                          ButtonSegment(value: _Mode.password, label: Text('По паролю')),
                        ],
                        selected: {_mode},
                        onSelectionChanged: (s) => _switchMode(s.first),
                      ),
                      const SizedBox(height: 24),
                      if (_mode == _Mode.otp) _buildOtpForms() else _buildPasswordForm(),
                      if (_error != null) _buildError(),
                      const SizedBox(height: 16),
                      Center(
                        child: TextButton(
                          onPressed: () => context.push('/register'),
                          child: const Text('Ещё нет аккаунта? Зарегистрироваться'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOtpForms() {
    if (_stage == _Stage.email) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _emailCtl,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'you@example.com',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _loading || _emailCtl.text.trim().isEmpty ? null : _requestOtp,
            child: Text(_loading ? 'Отправляем…' : 'Получить код'),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Код отправлен на ${_emailCtl.text.trim()}'),
        const SizedBox(height: 12),
        TextField(
          controller: _codeCtl,
          keyboardType: TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(6),
          ],
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, letterSpacing: 8),
          decoration: const InputDecoration(
            labelText: 'Код из письма',
            hintText: '123456',
            border: OutlineInputBorder(),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _loading || _codeCtl.text.length != 6 ? null : _verifyOtp,
          child: Text(_loading ? 'Входим…' : 'Войти'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _loading
              ? null
              : () => setState(() {
                    _stage = _Stage.email;
                    _codeCtl.clear();
                    _error = null;
                  }),
          child: const Text('← Изменить email / отправить код снова'),
        ),
      ],
    );
  }

  Widget _buildPasswordForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _emailCtl,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          decoration: const InputDecoration(
            labelText: 'Email',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _passwordCtl,
          obscureText: true,
          autofillHints: const [AutofillHints.password],
          decoration: const InputDecoration(
            labelText: 'Пароль',
            border: OutlineInputBorder(),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _loading ||
                  _emailCtl.text.trim().isEmpty ||
                  _passwordCtl.text.isEmpty
              ? null
              : _loginWithPassword,
          child: Text(_loading ? 'Входим…' : 'Войти'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => _switchMode(_Mode.otp),
          child: const Text('Забыли пароль? Войти по коду из письма'),
        ),
      ],
    );
  }

  Widget _buildError() {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.red.shade50,
          border: Border.all(color: Colors.red.shade200),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_error!, style: TextStyle(color: Colors.red.shade800)),
            if (_showRegisterCta) ...[
              const SizedBox(height: 8),
              GestureDetector(
                onTap: () => context.push('/register'),
                child: Text(
                  '→ Зарегистрироваться',
                  style: TextStyle(
                    color: Colors.blue.shade700,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
