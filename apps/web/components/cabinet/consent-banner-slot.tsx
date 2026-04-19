'use client';

import { useAuthStore } from '@/lib/auth-store';
import { ConsentBanner } from './consent-banner';

export function ConsentBannerSlot(): React.ReactElement {
  const requiresConsent = useAuthStore((s) => s.requiresConsent);
  return <ConsentBanner requiresConsent={requiresConsent} />;
}
