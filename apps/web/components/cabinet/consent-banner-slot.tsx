'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { useAuthStore } from '@/lib/auth-store';
import { ConsentBanner } from './consent-banner';

interface MeConsent {
  requiresConsent?: boolean;
}

/**
 * Флаг `requiresConsent` не персистится, а ответы входа (пароль/код) его не несут —
 * раньше баннер появлялся только при старте кабинета без accessToken (refresh).
 * Поэтому при наличии сессии сверяемся с GET /me (v0.72.0: участник, которого завёл
 * владелец, принимает политику сам при первом входе). Ключ ['me'] инвалидирует баннер.
 */
export function ConsentBannerSlot(): React.ReactElement {
  const requiresConsent = useAuthStore((s) => s.requiresConsent);
  const hasSession = useAuthStore((s) => s.accessToken !== null);
  const setConsent = useAuthStore((s) => s.setConsent);

  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeConsent>('/api/me'),
    enabled: hasSession,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (meQ.data) setConsent(meQ.data.requiresConsent ?? false);
  }, [meQ.data, setConsent]);

  return <ConsentBanner requiresConsent={requiresConsent} />;
}
