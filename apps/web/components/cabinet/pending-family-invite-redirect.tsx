'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { readPendingFamilyInvite } from '@/lib/family/pending-invite';

/**
 * Приглашение в семью, открытое без входа (v0.71.0): `/join/<code>` запомнил код,
 * пользователь вошёл/зарегистрировался и попал в кабинет — возвращаем его на `/join`.
 * Ключ удаляет сама страница `/join` (там пользователь уже видит приглашение),
 * поэтому повторного перехода не будет. Стоит в layout кабинета — работает на любой его странице.
 */
export function PendingFamilyInviteRedirect(): null {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (accessToken === null) return;
    const code = readPendingFamilyInvite();
    if (code) router.replace(`/join/${encodeURIComponent(code)}`);
  }, [accessToken, router]);

  return null;
}
