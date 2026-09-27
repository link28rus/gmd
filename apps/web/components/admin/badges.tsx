// apps/web/components/admin/badges.tsx
// Статус-бейджи админки. Все цвета — tinted (bg-*/15 + dark:text-*),
// поэтому одинаково читаются в light/dim/dark темах (в отличие от прежних
// сплошных bg-emerald-100 и т.п., которые ломались на тёмном фоне).
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'emerald' | 'amber' | 'red' | 'sky' | 'slate' | 'violet';

const TONE: Record<Tone, string> = {
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'bg-red-500/15 text-red-700 dark:text-red-400',
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  slate: 'bg-muted text-muted-foreground',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
};

export function Pill({
  tone,
  children,
  title,
  dot = false,
}: {
  tone: Tone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE[tone],
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function RoleBadge({ role }: { role: 'admin' | 'parent' }) {
  return role === 'admin' ? <Pill tone="sky">Админ</Pill> : <Pill tone="slate">Родитель</Pill>;
}

export function UserStatusBadge({
  deletedAt,
  blockedAt,
  blockedReason,
}: {
  deletedAt: string | null;
  blockedAt: string | null;
  blockedReason?: string | null;
}) {
  if (deletedAt) return <Pill tone="red">Удалён</Pill>;
  if (blockedAt)
    return (
      <Pill tone="amber" title={blockedReason ?? undefined}>
        Заблокирован
      </Pill>
    );
  return (
    <Pill tone="emerald" dot>
      Активен
    </Pill>
  );
}

export function FamilyStatusBadge({ deletedAt }: { deletedAt: string | null }) {
  return deletedAt ? (
    <Pill tone="red">Удалена</Pill>
  ) : (
    <Pill tone="emerald" dot>
      Активна
    </Pill>
  );
}

export function DeviceBadge({ status }: { status: 'online' | 'offline' | 'revoked' | 'none' }) {
  switch (status) {
    case 'online':
      return (
        <Pill tone="emerald" dot>
          Онлайн
        </Pill>
      );
    case 'offline':
      return <Pill tone="slate">Офлайн</Pill>;
    case 'revoked':
      return <Pill tone="amber">Отозвано</Pill>;
    default:
      return <Pill tone="slate">Не привязано</Pill>;
  }
}
