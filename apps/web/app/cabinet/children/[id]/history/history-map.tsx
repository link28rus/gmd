'use client';
import dynamic from 'next/dynamic';
import type { HistoryMapInnerProps } from './history-map-inner';

export const HistoryMap = dynamic<HistoryMapInnerProps>(
  () => import('./history-map-inner').then((m) => m.HistoryMapInner),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-muted" />,
  },
);
