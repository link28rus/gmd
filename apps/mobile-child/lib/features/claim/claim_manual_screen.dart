import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/version/app_version.dart';
import 'claim_code.dart';
import 'claim_controller.dart';

class ClaimManualScreen extends ConsumerStatefulWidget {
  const ClaimManualScreen({super.key});

  @override
  ConsumerState<ClaimManualScreen> createState() => _ClaimManualScreenState();
}

class _ClaimManualScreenState extends ConsumerState<ClaimManualScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _trySubmit(String raw) {
    final code = extractInviteCode(raw);
    if (code != null) {
      ref.read(claimControllerProvider.notifier).submitCode(code);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<ClaimState>(claimControllerProvider, (prev, next) {
      if (next.status == ClaimStatus.success) {
        context.go('/permissions/notifications');
      }
    });
    final state = ref.watch(claimControllerProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Введите код'),
        actions: const [
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 12),
            child: AppVersionLabel(),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text(
              'Код покажет мама или папа',
              style: TextStyle(fontSize: 18),
            ),
            const SizedBox(height: 16),
            const Text(
              'Из цифр и букв, например: 6K DM 3B 1W',
              style: TextStyle(fontSize: 14, color: Colors.black54),
            ),
            const SizedBox(height: 32),
            TextField(
              controller: _controller,
              enabled: state.status != ClaimStatus.inProgress,
              autofocus: true,
              // Обычная текстовая клавиатура — код содержит буквы (A-Z),
              // не только цифры. visiblePassword даёт стабильную раскладку
              // без автокоррекции/автокапитализации слов.
              keyboardType: TextInputType.visiblePassword,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                // Разрешаем 0-9, A-Z и пробелы/дефисы для UX — сами
                // нормализуем перед отправкой.
                FilteringTextInputFormatter.allow(RegExp(r'[0-9A-Za-z\s\-]')),
                // 8 содержательных + 3 разделителя (пробелы) = 11 макс.
                LengthLimitingTextInputFormatter(11),
                // Upper-case на лету.
                TextInputFormatter.withFunction(
                  (oldValue, newValue) => newValue.copyWith(
                    text: newValue.text.toUpperCase(),
                  ),
                ),
              ],
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 28,
                letterSpacing: 6,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: '6KDM3B1W',
              ),
              onChanged: (v) {
                // Авто-submit, когда после нормализации набралось ровно 8
                // валидных символов Crockford alphabet.
                if (extractInviteCode(v) != null) {
                  _trySubmit(v);
                }
              },
              onSubmitted: _trySubmit,
            ),
            if (state.status == ClaimStatus.inProgress) ...[
              const SizedBox(height: 16),
              const CircularProgressIndicator(),
            ],
            if (state.status == ClaimStatus.error) ...[
              const SizedBox(height: 16),
              Text(
                state.errorMessage ?? 'Ошибка',
                style: const TextStyle(color: Colors.red),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
