import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/env.dart';
import '../../core/providers.dart';
import '../zones/zone_format.dart' show apiExceptionOf;
import 'consent_providers.dart';

/// v0.72.0: блокирующий экран принятия политики конфиденциальности и
/// пользовательского соглашения. Открывается роутером, пока
/// [consentPendingUserProvider] совпадает с пользователем сессии.
class ConsentScreen extends ConsumerStatefulWidget {
  const ConsentScreen({super.key});

  @override
  ConsumerState<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends ConsumerState<ConsentScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _open(String path) async {
    final uri = Uri.parse('$webOrigin$path');
    var ok = false;
    try {
      ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      ok = false;
    }
    if (!ok && mounted) {
      setState(() => _error = 'Не удалось открыть браузер. Адрес: $uri');
    }
  }

  Future<void> _accept() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(consentRepositoryProvider).accept();
      ref.read(consentPendingUserProvider.notifier).state = null;
      if (mounted) context.go('/home');
    } catch (e) {
      final api = apiExceptionOf(e);
      if (mounted) {
        setState(() {
          _error = api == null
              ? 'Нет связи с сервером — проверьте интернет и повторите.'
              : 'Не удалось сохранить согласие (ошибка ${api.status}). Повторите.';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).logout();
    } catch (_) {
      // Выходим локально в любом случае.
    }
    ref.read(consentPendingUserProvider.notifier).state = null;
    ref.read(authSessionProvider.notifier).state = null;
    if (mounted) context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final email = ref.watch(authSessionProvider.select((s) => s?.user.email)) ?? '';
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          children: [
            Icon(Icons.privacy_tip_outlined, size: 56, color: scheme.primary),
            const SizedBox(height: 16),
            Text(
              'Политика конфиденциальности',
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            Text(
              'Чтобы пользоваться Перископом, прочитайте политику конфиденциальности '
              'и пользовательское соглашение и подтвердите согласие. В них описано, '
              'какие данные собирает сервис (аккаунт, семья, геолокация детей), '
              'зачем и как долго они хранятся.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Пока согласие не принято, данные можно только просматривать — '
              'изменения недоступны.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(color: scheme.outlineVariant),
              ),
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: const Text('Политика конфиденциальности'),
                    trailing: const Icon(Icons.open_in_new, size: 20),
                    onTap: _busy ? null : () => _open('/privacy'),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading: const Icon(Icons.gavel_outlined),
                    title: const Text('Пользовательское соглашение'),
                    trailing: const Icon(Icons.open_in_new, size: 20),
                    onTap: _busy ? null : () => _open('/terms'),
                  ),
                ],
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.error),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _accept,
              child: _busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Принимаю'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _busy ? null : _logout,
              child: Text(email.isEmpty ? 'Выйти' : 'Выйти ($email)'),
            ),
          ],
        ),
      ),
    );
  }
}
