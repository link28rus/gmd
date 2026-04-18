// apps/web/components/children/device-status-badge.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import type { ChildDevice } from '@/lib/api/children';

interface Props {
  device: ChildDevice | null;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function describeDevice(device: ChildDevice): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (device.revokedAt) return { label: 'Отозвано', variant: 'secondary' };
  if (!device.lastSeenAt) return { label: 'Привязано', variant: 'outline' };

  const ms = Date.now() - new Date(device.lastSeenAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 5) return { label: 'Онлайн', variant: 'default' };
  if (mins < 60) return { label: `${mins} мин назад`, variant: 'secondary' };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { label: `${hours} ч назад`, variant: 'secondary' };

  const d = new Date(device.lastSeenAt);
  return {
    label: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} в ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    variant: 'secondary',
  };
}

export function DeviceStatusBadge({ device }: Props) {
  if (!device) return <Badge variant="outline">Не привязано</Badge>;
  const { label, variant } = describeDevice(device);
  return <Badge variant={variant}>{label}</Badge>;
}
