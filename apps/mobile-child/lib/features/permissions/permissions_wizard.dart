import 'package:flutter/material.dart';

import '../../core/version/app_version.dart';
import 'wizard_steps.dart';

/// Общий каркас одного шага мастера выдачи разрешений.
///
/// Номер шага, прогресс и бейдж обязательности берутся из [kWizardSteps] по
/// [route] — не передаются вручную, поэтому нумерация всегда консистентна.
///
/// Кнопка «пропустить» ведёт себя по-разному в зависимости от важности шага:
///   - [StepImportance.mandatory] — «Не сейчас» с предупреждающим диалогом
///     (легко пропустить обязательное разрешение = приложение не работает);
///   - остальные — обычная кнопка «Пропустить».
class PermissionsWizardScaffold extends StatelessWidget {
  const PermissionsWizardScaffold({
    super.key,
    required this.route,
    required this.title,
    required this.description,
    required this.onRequest,
    required this.onSkip,
    this.actionLabel = 'Разрешить',
    this.footer,
    this.parentHint,
  });

  /// Маршрут этого шага (например `/permissions/location`) — ключ в [kWizardSteps].
  final String route;
  final String title;
  final String description;
  final VoidCallback onRequest;
  final VoidCallback onSkip;
  final String actionLabel;
  final Widget? footer;

  /// Короткая подсказка «настраивает взрослый», показывается для шагов,
  /// которые открывают системные настройки Android.
  final String? parentHint;

  Future<void> _confirmMandatorySkip(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Пропустить обязательный шаг?'),
        content: Text(
          'Без разрешения «$title» приложение не сможет полноценно работать: '
          'родитель может не увидеть, где ребёнок. Настроить можно позже на '
          'главном экране, но лучше сделать это сейчас.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Вернуться'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Всё равно пропустить'),
          ),
        ],
      ),
    );
    if (confirmed == true) onSkip();
  }

  @override
  Widget build(BuildContext context) {
    final index = wizardIndexOf(route);
    final total = kWizardTotalSteps;
    final stepNumber = index >= 0 ? index + 1 : 1;
    final importance =
        index >= 0 ? kWizardSteps[index].importance : StepImportance.recommended;
    final progress = index >= 0 ? stepNumber / total : null;

    return Scaffold(
      appBar: AppBar(
        title: Text('Шаг $stepNumber из $total'),
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
            LinearProgressIndicator(value: progress),
            const SizedBox(height: 24),
            _ImportanceBadge(importance: importance),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            Text(description, style: const TextStyle(fontSize: 16, height: 1.4)),
            if (parentHint != null) ...[
              const SizedBox(height: 16),
              _ParentHint(text: parentHint!),
            ],
            if (footer != null) ...[const SizedBox(height: 16), footer!],
            const SizedBox(height: 32),
            FilledButton(
              onPressed: onRequest,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(actionLabel),
              ),
            ),
            const SizedBox(height: 4),
            if (importance == StepImportance.mandatory)
              TextButton(
                onPressed: () => _confirmMandatorySkip(context),
                child: const Text('Не сейчас'),
              )
            else
              TextButton(
                onPressed: onSkip,
                child: const Text('Пропустить'),
              ),
          ],
        ),
      ),
    );
  }
}

class _ImportanceBadge extends StatelessWidget {
  const _ImportanceBadge({required this.importance});

  final StepImportance importance;

  @override
  Widget build(BuildContext context) {
    final color = importance.color;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          importance.label,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ParentHint extends StatelessWidget {
  const _ParentHint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F6FB),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, size: 18, color: Color(0xFF1976D2)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 13, color: Color(0xFF33475B)),
            ),
          ),
        ],
      ),
    );
  }
}
