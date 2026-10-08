'use client';

import { useAuthStore } from '@/lib/auth-store';
import { refreshAccessToken } from './refresh-singleflight';

/**
 * Принудительный refresh после смены членства в семье (принял приглашение,
 * вышел, передал права): новый токен несёт актуальные familyId/роль, а
 * `user`/`family` в auth-store обновляются из ответа. Возвращает false,
 * если сессию обновить не удалось (refresh-cookie нет или отозван).
 */
export async function refreshSession(): Promise<boolean> {
  const data = await refreshAccessToken();
  if (!data) return false;
  const store = useAuthStore.getState();
  if (data.user && data.family) {
    store.setAll({ accessToken: data.accessToken, user: data.user, family: data.family });
    store.setConsent(data.requiresConsent ?? false);
  } else {
    store.setAccess(data.accessToken);
  }
  return true;
}
