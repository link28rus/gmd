'use client';
import type { ReactElement, ReactNode } from 'react';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { formatAgeShort } from '@/lib/date/age-format';

interface Props {
  childName: string;
  ageSec: number;
  accuracy: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  provider: 'gps' | 'fused' | 'network' | null;
  networkType: 'wifi' | 'mobile' | 'offline' | 'unknown' | null;
  /** Блок действий (напр. «Отвязать устройство», «Удалить ребёнка») под метриками. */
  actions?: ReactNode;
}

export function ChildStatusCard({
  childName,
  ageSec,
  accuracy,
  batteryLevel,
  isCharging,
  provider,
  networkType,
  actions,
}: Props): ReactElement {
  const initial = avatarInitial(childName);
  const color = avatarColor(childName);

  return (
    <div className="w-[280px] rounded-lg border border-zinc-200 bg-white shadow-md">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: color }}
        >
          <span className="text-base font-semibold">{initial}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-900">{childName}</div>
          <div className="truncate text-xs text-zinc-500">Был тут {formatAgeShort(ageSec)}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 px-3 py-2.5 text-center text-[11px] text-zinc-600">
        <Metric
          label={batteryLabel(batteryLevel, isCharging)}
          value={batteryLevel !== null ? `${batteryLevel}%` : '—'}
          valueColor={batteryColor(batteryLevel)}
          icon={isCharging ? '🔌' : '🔋'}
        />
        <Metric
          label="точность"
          value={accuracy !== null ? `±${Math.round(accuracy)} м` : '—'}
          icon="🎯"
        />
        <Metric label="связь" value={networkLabel(networkType)} icon={networkIcon(networkType)} />
        <Metric label="источник" value={providerLabel(provider)} icon="📡" />
      </div>
      {accuracy !== null && (
        <div className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500">
          Точность координат {accuracyQuality(accuracy)} ({Math.round(accuracy)} метров)
        </div>
      )}
      {actions}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  valueColor,
}: {
  label: string;
  value: string;
  icon: string;
  valueColor?: string;
}): ReactElement {
  return (
    <div className="flex flex-col items-center">
      <div className="text-sm">{icon}</div>
      <div
        className="font-semibold text-zinc-900"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
    </div>
  );
}

function batteryColor(level: number | null): string | undefined {
  if (level === null) return undefined;
  if (level <= 20) return '#dc2626';
  if (level <= 40) return '#ea580c';
  return undefined;
}

function batteryLabel(_level: number | null, charging: boolean | null): string {
  if (charging) return 'заряжается';
  return 'батарея';
}

function providerLabel(p: 'gps' | 'fused' | 'network' | null): string {
  switch (p) {
    case 'gps':
      return 'GPS';
    case 'fused':
      return 'GPS';
    case 'network':
      return 'сеть';
    default:
      return '—';
  }
}

function networkLabel(n: 'wifi' | 'mobile' | 'offline' | 'unknown' | null): string {
  switch (n) {
    case 'wifi':
      return 'Wi-Fi';
    case 'mobile':
      return 'мобильн.';
    case 'offline':
      return 'нет сети';
    default:
      return '—';
  }
}

function networkIcon(n: 'wifi' | 'mobile' | 'offline' | 'unknown' | null): string {
  switch (n) {
    case 'wifi':
      return '📶';
    case 'mobile':
      return '📱';
    case 'offline':
      return '🚫';
    default:
      return '❓';
  }
}

function accuracyQuality(m: number): string {
  if (m <= 30) return 'высокая';
  if (m <= 100) return 'средняя';
  return 'низкая';
}
