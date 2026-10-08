'use client';

/**
 * Код приглашения в семью, открытого без входа (v0.71.0). `/join/<code>` кладёт его
 * в localStorage, после входа/регистрации кабинет возвращает пользователя на `/join`.
 * Живёт столько же, сколько приглашение (7 дней) — дальше backend его всё равно не примет.
 */

export const PENDING_FAMILY_INVITE_KEY = 'gmd_pending_family_invite';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Stored {
  code: string;
  savedAt: number;
}

export function savePendingFamilyInvite(code: string): void {
  try {
    const v: Stored = { code, savedAt: Date.now() };
    window.localStorage.setItem(PENDING_FAMILY_INVITE_KEY, JSON.stringify(v));
  } catch {
    /* приватный режим / квота — не критично */
  }
}

/** Свежий код или null (протухший/битый ключ удаляется). */
export function readPendingFamilyInvite(now = Date.now()): string | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PENDING_FAMILY_INVITE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof v.code === 'string' &&
      v.code.length > 0 &&
      typeof v.savedAt === 'number' &&
      now - v.savedAt >= 0 &&
      now - v.savedAt < TTL_MS
    ) {
      return v.code;
    }
  } catch {
    /* битое значение — удалим ниже */
  }
  clearPendingFamilyInvite();
  return null;
}

export function clearPendingFamilyInvite(): void {
  try {
    window.localStorage.removeItem(PENDING_FAMILY_INVITE_KEY);
  } catch {
    /* ignore */
  }
}
