import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/version/app_version.dart';
import 'wizard_steps.dart';

/// Вводный экран мастера разрешений — показывается сразу после привязки к семье.
///
/// Задаёт ожидания: сколько шагов, что часть откроет системные настройки, и что
/// настраивать удобнее взрослому. Без него родитель «падал» в 9 экранов подряд
/// без понимания объёма.
class WizardIntroScreen extends StatelessWidget {
  const WizardIntroScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final mandatory =
        kWizardSteps.where((s) => s.importance == StepImportance.mandatory).length;
    final recommended = kWizardSteps
        .where((s) => s.importance == StepImportance.recommended)
        .length;
    final optional =
        kWizardSteps.where((s) => s.importance == StepImportance.optional).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Настройка телефона'),
        automaticallyImplyLeading: false,
        actions: const [
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 12),
            child: AppVersionLabel(),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 8),
            const Icon(Icons.verified_user_outlined,
                size: 72, color: Color(0xFF1976D2)),
            const SizedBox(height: 20),
            Text(
              'Осталось выдать разрешения',
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            const Text(
              'Устройство привязано к семье. Теперь настроим доступ, чтобы '
              'приложение работало в фоне и присылало родителю местоположение. '
              'Это займёт 2–3 минуты.',
              style: TextStyle(fontSize: 16, height: 1.4),
            ),
            const SizedBox(height: 24),
            _InfoRow(
              icon: Icons.format_list_numbered,
              text: 'Всего $kWizardTotalSteps шагов: '
                  '$mandatory обязательных, $recommended рекомендуемых, '
                  '$optional по желанию.',
            ),
            const SizedBox(height: 12),
            const _InfoRow(
              icon: Icons.settings_suggest_outlined,
              text: 'Часть шагов откроет системные настройки Android. Включите '
                  'нужный тумблер и вернитесь в приложение — мы проверим сами.',
            ),
            const SizedBox(height: 12),
            const _InfoRow(
              icon: Icons.person_outline,
              text: 'Настройку лучше пройти взрослому — некоторые разрешения '
                  'требуют системных экранов.',
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: () => context.go(kWizardSteps.first.route),
              child: const Padding(
                padding: EdgeInsets.all(14),
                child: Text('Начать настройку', style: TextStyle(fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 22, color: const Color(0xFF1976D2)),
        const SizedBox(width: 12),
        Expanded(
          child: Text(text, style: const TextStyle(fontSize: 15, height: 1.35)),
        ),
      ],
    );
  }
}
