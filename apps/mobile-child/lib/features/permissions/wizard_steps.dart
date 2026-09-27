import 'package:flutter/material.dart';

/// Насколько разрешение важно для работы приложения. Определяет визуальный
/// бейдж на шаге и поведение кнопки «пропустить».
enum StepImportance {
  /// Без него приложение бессмысленно (геолокация, фон, уведомления). Пропуск
  /// возможен только через явное подтверждение с предупреждением.
  mandatory,

  /// Нужно для конкретной функции родительского контроля (защита от удаления,
  /// звук вокруг, обновления). Можно пропустить.
  recommended,

  /// Приятное дополнение (экономия батареи). Спокойно пропускается.
  optional,
}

extension StepImportanceUi on StepImportance {
  String get label => switch (this) {
        StepImportance.mandatory => 'Обязательно',
        StepImportance.recommended => 'Рекомендуется',
        StepImportance.optional => 'По желанию',
      };

  Color get color => switch (this) {
        StepImportance.mandatory => const Color(0xFFD32F2F), // red 700
        StepImportance.recommended => const Color(0xFF1976D2), // blue 700
        StepImportance.optional => const Color(0xFF757575), // grey 600
      };
}

/// Один шаг мастера выдачи разрешений. Порядок в [kWizardSteps] = порядок
/// прохождения, поэтому нумерация и навигация «дальше» вычисляются из него —
/// не хардкодятся в каждом экране (раньше totalSteps:9 расходился с реальным
/// числом шагов, и «шаг 6» пропадал из-за placeholder'а).
class WizardStep {
  const WizardStep({
    required this.route,
    required this.title,
    required this.importance,
  });

  final String route;
  final String title;
  final StepImportance importance;
}

/// Каноничный порядок мастера: сначала обязательное (без чего трекинг не
/// работает), затем функции родительского контроля (открывают системные
/// настройки, проходит взрослый), в конце — необязательная экономия батареи.
const List<WizardStep> kWizardSteps = [
  WizardStep(
    route: '/permissions/notifications',
    title: 'Уведомления',
    importance: StepImportance.mandatory,
  ),
  WizardStep(
    route: '/permissions/location',
    title: 'Местоположение',
    importance: StepImportance.mandatory,
  ),
  WizardStep(
    route: '/permissions/battery',
    title: 'Работа в фоне',
    importance: StepImportance.mandatory,
  ),
  WizardStep(
    route: '/permissions/devadmin',
    title: 'Защита от удаления',
    importance: StepImportance.recommended,
  ),
  WizardStep(
    route: '/permissions/microphone',
    title: 'Звук вокруг ребёнка',
    importance: StepImportance.recommended,
  ),
  WizardStep(
    route: '/permissions/updates',
    title: 'Обновления приложения',
    importance: StepImportance.recommended,
  ),
  WizardStep(
    route: '/permissions/activity',
    title: 'Экономия батареи',
    importance: StepImportance.optional,
  ),
];

/// Индекс шага в мастере по его маршруту (0-based). -1 если не найден.
int wizardIndexOf(String route) =>
    kWizardSteps.indexWhere((s) => s.route == route);

/// Маршрут следующего шага после [route]. Последний шаг ведёт на экран-итог.
String wizardNextRoute(String route) {
  final i = wizardIndexOf(route);
  if (i < 0 || i + 1 >= kWizardSteps.length) return '/permissions/summary';
  return kWizardSteps[i + 1].route;
}

int get kWizardTotalSteps => kWizardSteps.length;
