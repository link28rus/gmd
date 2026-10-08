'use client';
import dynamic from 'next/dynamic';
import type { PhoneMapInnerProps } from './phone-map-inner';

// Leaflet трогает window при импорте — только на клиенте.
export const PhoneMap = dynamic<PhoneMapInnerProps>(
  () => import('./phone-map-inner').then((m) => m.PhoneMapInner),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-muted" />,
  },
);
