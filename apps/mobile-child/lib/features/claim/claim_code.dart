// apps/mobile-child/lib/features/claim/claim_code.dart
//
// Нормализация и валидация invite-кода — единая логика для сканера и ручного ввода.
// Backend (apps/backend/src/invites/lib/code-generator.ts): 8 символов Crockford
// base32 (0-9, A-Z минус I, L, O, U). Сам backend тоже нормализует на входе
// (убирает пробелы/дефисы, toUpperCase), так что клиентская нормализация —
// для UX (можно писать «6K DM 3B 1W» или «6K-DM-3B-1W»), не для безопасности.

/// Валидный Crockford base32 alphabet — как в backend.
const String inviteAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const int inviteCodeLength = 8;

final RegExp _inviteCodeRegExp = RegExp(r'^[0-9A-HJKMNP-TV-Z]{8}$');

/// Убирает пробелы, дефисы, приводит к верхнему регистру.
String normalizeInviteInput(String raw) {
  return raw.replaceAll(RegExp(r'[\s\-]'), '').toUpperCase();
}

/// Пытается вытащить invite-код из произвольного входа:
/// - URL `https://periscop.pro/claim/6KDM3B1W`
/// - Deep-link `periscop://claim/6KDM3B1W`
/// - Просто код `6KDM3B1W` / `6K-DM-3B-1W` / `6k dm 3b 1w`
///
/// Возвращает код в каноничной форме (8 символов alphanumeric)
/// или null, если распознать не удалось.
String? extractInviteCode(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final trimmed = raw.trim();

  // 1) URL/deep-link: берём последний path-сегмент после /claim/.
  final match =
      RegExp(r'(?:/claim/)([^/?#]+)', caseSensitive: false).firstMatch(trimmed);
  final candidate = match != null ? match.group(1)! : trimmed;

  final normalized = normalizeInviteInput(candidate);
  if (_inviteCodeRegExp.hasMatch(normalized)) {
    return normalized;
  }
  return null;
}
