import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/version/app_version.dart';
import 'claim_code.dart';
import 'claim_controller.dart';

class ClaimScreen extends ConsumerStatefulWidget {
  const ClaimScreen({super.key});

  @override
  ConsumerState<ClaimScreen> createState() => _ClaimScreenState();
}

class _ClaimScreenState extends ConsumerState<ClaimScreen> {
  bool _handled = false;

  @override
  Widget build(BuildContext context) {
    ref.listen<ClaimState>(claimControllerProvider, (prev, next) {
      if (next.status == ClaimStatus.success) {
        context.go('/permissions/notifications');
      }
      // При ошибке НЕ сбрасываем _handled автоматически — иначе камера
      // тут же детектит тот же QR и запускает submitCode снова, зацикливая
      // запросы и выжирая rate-limit (thr:/child/claim = 10 req / 10 мин).
      // Пользователь явно нажимает «Попробовать ещё раз» либо уходит в manual.
    });

    final state = ref.watch(claimControllerProvider);
    final hasError = state.status == ClaimStatus.error;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Покажи код от родителя'),
        actions: const [
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 12),
            child: AppVersionLabel(),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: (capture) {
              if (_handled) return;
              for (final b in capture.barcodes) {
                // QR может содержать URL (`https://…/claim/CODE`), deep-link
                // (`gmd://claim/CODE`) или просто код — extractInviteCode
                // покрывает все случаи и возвращает канонические 8 символов.
                final code = extractInviteCode(b.rawValue);
                if (code != null) {
                  _handled = true;
                  ref.read(claimControllerProvider.notifier).submitCode(code);
                  break;
                }
              }
            },
          ),
          if (hasError)
            Positioned(
              top: 16,
              left: 16,
              right: 16,
              child: Material(
                color: Colors.red.shade700,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    state.errorMessage ?? 'Не удалось привязать устройство',
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (hasError) ...[
                    ElevatedButton(
                      onPressed: () {
                        _handled = false;
                        ref.read(claimControllerProvider.notifier).reset();
                      },
                      child: const Text('Попробовать ещё раз'),
                    ),
                    const SizedBox(height: 12),
                  ],
                  ElevatedButton(
                    onPressed: () => context.go('/claim/manual'),
                    child: const Text('Ввести код вручную'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
