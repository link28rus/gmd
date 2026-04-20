import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'home_controller.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(homeInitProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('GMD')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('Привет!', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Ты подключён к семье'),
            const SizedBox(height: 24),
            Row(children: const [
              Icon(Icons.check_circle, color: Colors.green),
              SizedBox(width: 8),
              Text('Связь с домом есть'),
            ]),
            const Spacer(),
            SizedBox(
              width: 200, height: 200,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Colors.red, shape: const CircleBorder()),
                onPressed: () {},
                child: const Text('SOS', style: TextStyle(fontSize: 32, color: Colors.white)),
              ),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
