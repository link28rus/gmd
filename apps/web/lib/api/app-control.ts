// v0.38 Phase 6.1: API client для «Родительский контроль» (screen-time).
import { apiFetch } from './client';

export type AppCategory =
  | 'social'
  | 'messengers'
  | 'video'
  | 'games'
  | 'browsers'
  | 'education'
  | 'music'
  | 'navigation'
  | 'shopping'
  | 'system'
  | 'other';

export interface InstalledAppDto {
  packageName: string;
  appLabel: string;
  iconUrl: string | null;
  category: AppCategory;
  isSystem: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  todaySeconds: number;
}

export interface UsageRangeDto {
  totalSeconds: number;
  byHour: number[]; // length=24 для day, length=7 для week
  byPackage: Array<{
    packageName: string;
    appLabel: string | null;
    seconds: number;
    category: AppCategory;
  }>;
  byCategory: Record<AppCategory, number>;
  vsAverage: number | null;
}

export interface UsageResponseDto {
  range: 'day' | 'week';
  result: UsageRangeDto;
}

export const appControlApi = {
  installedApps: (childId: string) =>
    apiFetch<{ apps: InstalledAppDto[] }>(`/api/children/${childId}/app-control/installed-apps`),
  usage: (childId: string, range: 'day' | 'week', date?: string) => {
    const params = new URLSearchParams({ range });
    if (date) params.set('date', date);
    return apiFetch<UsageResponseDto>(
      `/api/children/${childId}/app-control/usage?${params.toString()}`,
    );
  },
};

/**
 * Backend возвращает iconUrl типа `https://api.gmd.../app-icons/<sha256>` —
 * собрано на бэкенде через X-Forwarded-Host. На web работает проксируем
 * через `/api/app-icons/<sha256>` (single origin, immutable cache).
 *
 * Эта функция извлекает sha256 из URL'а бэка и подменяет на наш proxy.
 * Если backend по какой-то причине не отдал sha256 в URL — возвращаем как есть.
 */
export function rewriteIconUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  const m = rawUrl.match(/\/app-icons\/([0-9a-f]{64})$/);
  if (!m) return rawUrl;
  return `/api/app-icons/${m[1]}`;
}
