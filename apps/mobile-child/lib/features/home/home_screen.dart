import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/version/app_version.dart';
import '../sos/sos_controller.dart';
import 'home_controller.dart';
import 'permission_health_banner.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(homeInitProvider);

    ref.listen<SosState>(sosControllerProvider, (prev, next) {
      if (prev?.status == next.status) return;
      final messenger = ScaffoldMessenger.maybeOf(context);
      if (messenger == null) return;
      if (next.status == SosStatus.success) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Помощь идёт 💚')),
        );
      } else if (next.status == SosStatus.error) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(next.errorMessage ?? 'Не удалось отправить SOS'),
            backgroundColor: Colors.red,
          ),
        );
      }
    });

    final sosState = ref.watch(sosControllerProvider);
    final isSending = sosState.status == SosStatus.sending;

    return Scaffold(
      appBar: AppBar(
        title: const Text('GMD'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: GestureDetector(
              onLongPress: () => context.push('/debug'),
              child: const AppVersionLabel(),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          const PermissionHealthBanner(),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  const Text('Привет!',
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Ты подключён к семье'),
            const SizedBox(height: 24),
            Row(children: const [
              Icon(Icons.check_circle, color: Colors.green),
              SizedBox(width: 8),
              Text('Связь с домом есть'),
            ]),
            const Spacer(),
            const Text(
              'Удерживай кнопку SOS,\nчтобы позвать на помощь',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 16),
            GestureDetector(
              onLongPress: isSending ? null : () => _confirmAndSend(context, ref),
              child: SizedBox(
                width: 200,
                height: 200,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isSending ? Colors.redAccent : Colors.red,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.red.withValues(alpha: 0.4),
                        blurRadius: 16,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Center(
                    child: isSending
                        ? const SizedBox(
                            width: 48,
                            height: 48,
                            child: CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 4,
                            ),
                          )
                        : const Text(
                            'SOS',
                            style: TextStyle(
                                fontSize: 32,
                                color: Colors.white,
                                fontWeight: FontWeight.bold),
                          ),
                  ),
                ),
              ),
            ),
                  const Spacer(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmAndSend(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отправить SOS?'),
        content:
            const Text('Родители получат тревожное уведомление с твоими координатами.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Да, отправить'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(sosControllerProvider.notifier).send();
    }
  }
}
