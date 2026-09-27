import 'package:flutter/material.dart';

/// Брендовый seed-цвет «Перископ» — зелёный. Из него Material 3
/// выводит всю палитру (light и dark) через [ColorScheme.fromSeed].
const kBrandSeed = Color(0xFF2E7D32);

/// Семантические цвета, которые НЕ выводятся из бренд-seed: если маппить их
/// на `colorScheme.primary`, они сольются с брендом (seed сам зелёный) или
/// потеряют смысл при переключении темы. Держим отдельными константами.
class AppColors {
  const AppColors._();

  /// Онлайн-статус ребёнка — явный «живой» зелёный индикатор. Отличается от
  /// бренд-primary, чтобы точка-статус читалась и на зелёных акцентах.
  static const online = Color(0xFF22C55E);

  /// Предупреждение (согласие 14+, низкий заряд и т.п.) — янтарная пара.
  /// Material seed не даёт стабильного «warning»-роля, поэтому свои константы,
  /// адаптивные к яркости темы.
  static Color warningContainer(Brightness b) =>
      b == Brightness.dark ? const Color(0xFF3E3100) : const Color(0xFFFFF8E1);
  static Color onWarningContainer(Brightness b) =>
      b == Brightness.dark ? const Color(0xFFFFE082) : const Color(0xFF6B4E00);
  static Color warningBorder(Brightness b) =>
      b == Brightness.dark ? const Color(0xFF5C4A00) : const Color(0xFFFFE082);
}

/// Светлая тема приложения родителя.
ThemeData buildLightTheme() => _build(Brightness.light);

/// Тёмная тема приложения родителя.
ThemeData buildDarkTheme() => _build(Brightness.dark);

ThemeData _build(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: kBrandSeed,
    brightness: brightness,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
  );
}
