/**
 * Публичная регистрация (POST /auth/register).
 *
 * С 2026-10-13 прод семейный: аккаунты взрослым создаёт владелец семьи
 * (POST /family/members) или выдаёт приглашение для уже существующего аккаунта.
 * Регистрация закрыта по умолчанию в production; в dev/e2e открыта, чтобы
 * тесты и локальный стек работали. Явно — env REGISTRATION_ENABLED=true|false.
 */
export function registrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.REGISTRATION_ENABLED === 'true') return true;
  if (env.REGISTRATION_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}
