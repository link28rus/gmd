import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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

  @override
  Widget build(BuildContext context) {
    ref.listen<ClaimState>(claimControllerProvider, (prev, next) {
      if (next.status == ClaimStatus.success) {
        context.go('/permissions/notifications');
      }
    });
    final state = ref.watch(claimControllerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Введите код')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text(
              'Код покажет мама или папа',
              style: TextStyle(fontSize: 18),
            ),
            const SizedBox(height: 32),
            TextField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 32, letterSpacing: 12),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: '000000',
              ),
              onChanged: (v) {
                if (v.length == 6) {
                  ref.read(claimControllerProvider.notifier).submitCode(v);
                }
              },
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
