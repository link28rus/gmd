import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
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
      } else if (next.status == ClaimStatus.error) {
        setState(() => _handled = false);
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Покажи код от родителя')),
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
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Center(
              child: ElevatedButton(
                onPressed: () => context.go('/claim/manual'),
                child: const Text('Ввести код вручную'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
