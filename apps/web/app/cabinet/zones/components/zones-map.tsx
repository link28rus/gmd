// apps/web/app/cabinet/zones/components/zones-map.tsx
'use client';

import dynamic from 'next/dynamic';
import type { ZonesMapInnerProps } from './zones-map-inner';

export const ZonesMap = dynamic<ZonesMapInnerProps>(
  () => import('./zones-map-inner').then((m) => m.ZonesMapInner),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-muted" />,
  },
);
