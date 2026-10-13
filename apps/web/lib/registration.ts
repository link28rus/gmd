import 'server-only';

/**
 * Публичная регистрация — тот же флаг, что у backend (src/auth/registration.ts):
 * закрыта по умолчанию в production, в dev открыта, явно — REGISTRATION_ENABLED.
 * С 2026-10-13 прод семейный: аккаунт взрослому создаёт владелец семьи.
 * При возврате регистрации — вернуть и ссылки на /register (вход, /join,
 * /confirm-email), их сняли вместе с закрытием.
 */
export function registrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.REGISTRATION_ENABLED === 'true') return true;
  if (env.REGISTRATION_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}
