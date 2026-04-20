'use client';

import dynamic from 'next/dynamic';
import type { ZoneEditorMapInnerProps } from './zone-editor-map-inner';

export const ZoneEditorMap = dynamic<ZoneEditorMapInnerProps>(
  () => import('./zone-editor-map-inner').then((m) => m.ZoneEditorMapInner),
  {
    ssr: false,
    loading: () => <div className="h-[400px] animate-pulse bg-zinc-100 rounded-md" />,
  },
);

export type { ZoneEditorMapInnerProps };
