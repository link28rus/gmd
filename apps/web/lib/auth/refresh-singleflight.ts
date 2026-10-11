'use client';

/**
 * Single-flight refresh: гарантирует, что одновременно выполняется не более
 * одного `POST /api/auth/refresh`.
 *
 * Зачем: backend ротирует refresh-token при каждом успешном refresh (старый
 * становится revoked). Если несколько вкладок параллельно дёргают refresh с
 * одним и тем же cookie (heartbeat ping каждые 2 мин, одновременный 401 после
 * истечения accessToken), одна выигрывает, остальные приходят со старым
 * токеном и раньше падали в replay-detection → revoke-all → юзер кикался во
 * всех вкладках сразу. Backend теперь даёт 10s grace, но на клиенте всё равно
 * лучше избежать лишних refresh.
 *
 * Уровни защиты:
 *  - Внутри одной вкладки: module-level promise.
 *  - Между вкладками: Web Locks API (`navigator.locks`) — поддерживается всеми
 *    современными браузерами (Chrome 69+, Safari 15.4+, Firefox 96+).
 *
 * Для сред без Web Locks (например, SSR или старый WebView) деградирует в
 * обычный fetch — это безопасно благодаря backend grace-period.
 */

import type { AuthFamily, AuthUser } from '@/lib/auth-store';
import { REFRESH_UNAVAILABLE_COOKIE } from '@/lib/auth/session-cookie';

export interface RefreshResponse {
  accessToken: string;
  user?: AuthUser;
  family?: AuthFamily;
  requiresConsent?: boolean;
}

const LOCK_NAME = 'gmd-auth-refresh';

function markUnavailable(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${REFRESH_UNAVAILABLE_COOKIE}=1; Max-Age=30; Path=/; SameSite=Lax`;
}

function clearUnavailable(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${REFRESH_UNAVAILABLE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

let inFlight: Promise<RefreshResponse | null> | null = null;

async function doRefresh(): Promise<RefreshResponse | null> {
  let res: Response;
  try {
    res = await fetch('/api/auth/refresh', { method: 'POST' });
  } catch {
    markUnavailable();
    return null;
  }
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) markUnavailable();
    return null;
  }
  clearUnavailable();
  return (await res.json()) as RefreshResponse;
}

export async function refreshAccessToken(): Promise<RefreshResponse | null> {
  if (inFlight) return inFlight;
  const supportsLocks = typeof navigator !== 'undefined' && 'locks' in navigator;
  inFlight = (async () => {
    try {
      if (supportsLocks) {
        return await navigator.locks.request(LOCK_NAME, () => doRefresh());
      }
      return await doRefresh();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
