import 'package:flutter/material.dart';

import '../../core/version/app_version.dart';

class PermissionsWizardScaffold extends StatelessWidget {
  const PermissionsWizardScaffold({
    super.key,
    required this.stepIndex,
    required this.totalSteps,
    required this.title,
    required this.description,
    required this.onRequest,
    required this.onSkip,
    this.actionLabel = 'Разрешить',
    this.footer,
  });

  final int stepIndex;
  final int totalSteps;
  final String title;
  final String description;
  final VoidCallback onRequest;
  final VoidCallback onSkip;
  final String actionLabel;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Шаг ${stepIndex + 1} из $totalSteps'),
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
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LinearProgressIndicator(value: (stepIndex + 1) / totalSteps),
            const SizedBox(height: 24),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            Text(description, style: const TextStyle(fontSize: 16)),
            if (footer != null) ...[const SizedBox(height: 16), footer!],
            const Spacer(),
            FilledButton(
              onPressed: onRequest,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(actionLabel),
              ),
            ),
            TextButton(onPressed: onSkip, child: const Text('Пропустить')),
          ],
        ),
      ),
    );
  }
}
