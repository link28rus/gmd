// v0.38 Phase 6.1: API client для «Родительский контроль» (screen-time).
// v0.39 Phase 6.2: + App Blocking (BlockSession, AppRule).
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

// ─── Phase 6.2 (v0.39): App Blocking ─────────────────────────────────────
//
// HARDCODED packages зашиты в backend (см. AppBlockingService.HARDCODED_ALLOWED).
// UI должен показывать их в whitelist как «всегда разрешено» (toggle disabled
// в позиции ON), чтобы родитель видел, что наш child app не заблокируется.
export const HARDCODED_ALLOWED_PACKAGES = ['ru.link28rus.gmd.child', 'ru.oneme.app'] as const;

export type AppRuleMode = 'DEFAULT' | 'ALWAYS_ALLOWED' | 'ALWAYS_BLOCKED';
export type AppRuleSource = 'PARENT' | 'SYSTEM_DEFAULT' | 'HARDCODED';

export interface AppRuleDto {
  packageName: string;
  mode: string; // backend возвращает upper-case enum, нормализуем на клиенте
  source: string;
}

export interface BlockSessionDto {
  sessionId: string;
  startedAt: string; // ISO
  endsAt: string; // ISO
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

  // ─── Block sessions ────────────────────────────────────────────────────
  createBlockSession: (childId: string, durationMin: number) =>
    apiFetch<BlockSessionDto>(`/api/children/${childId}/app-control/block-sessions`, {
      method: 'POST',
      body: JSON.stringify({ durationMin }),
    }),
  /**
   * Активная сессия. Возвращает null если у ребёнка нет ACTIVE сессии (backend
   * отдаёт `null` строкой в JSON — apiFetch разворачивает в JS null).
   */
  activeBlockSession: (childId: string) =>
    apiFetch<BlockSessionDto | null>(`/api/children/${childId}/app-control/block-sessions/active`),
  stopBlockSession: (childId: string, sessionId: string) =>
    apiFetch<void>(`/api/children/${childId}/app-control/block-sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  // ─── App rules (whitelist) ─────────────────────────────────────────────
  /**
   * Список явно сохранённых правил (PARENT + SYSTEM_DEFAULT). HARDCODED не
   * включаются — UI добавляет их статически из HARDCODED_ALLOWED_PACKAGES.
   */
  listAppRules: (childId: string) =>
    apiFetch<{ rules: AppRuleDto[] }>(`/api/children/${childId}/app-control/app-rules`),
  /**
   * Установить правило. mode: 'ALWAYS_ALLOWED' добавляет в whitelist,
   * 'DEFAULT' откатывает к default (не в whitelist).
   */
  putAppRule: (childId: string, packageName: string, mode: AppRuleMode) =>
    apiFetch<AppRuleDto>(
      `/api/children/${childId}/app-control/app-rules/${encodeURIComponent(packageName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      },
    ),
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
