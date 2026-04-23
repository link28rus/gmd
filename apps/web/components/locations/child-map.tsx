'use client';
import dynamic from 'next/dynamic';
import type { ChildMapInnerProps } from './child-map-inner';

export const ChildMap = dynamic<ChildMapInnerProps>(
  () => import('./child-map-inner').then((m) => m.ChildMapInner),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-muted" />,
  },
);
