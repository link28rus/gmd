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

// ─── Phase 6.x (v0.48): App Block Schedules ─────────────────────────────
//
// Расписание автоблокировки: дни недели + временное окно. Дополняет разовые
// BlockSession. Пока единственный mode — BLOCK_NON_ALLOWED (whitelist-based,
// идентично сессии).

export type AppBlockScheduleMode = 'BLOCK_NON_ALLOWED';

export interface AppBlockScheduleDto {
  id: string;
  name: string;
  enabled: boolean;
  /** 7-битная маска ISO weekday: 1=ПН … 7=ВС, bit i-1. Будни=31, выходные=96, ежедневно=127. */
  daysMask: number;
  startMin: number;
  endMin: number;
  /** "HH:MM" представление startMin (для UI без повторного форматирования). */
  startTime: string;
  endTime: string;
  /** true если startMin > endMin (окно через полночь). */
  crossesMidnight: boolean;
  mode: AppBlockScheduleMode;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleBody {
  name: string;
  daysMask: number;
  startMin: number;
  endMin: number;
  enabled?: boolean;
  mode?: AppBlockScheduleMode;
}

export interface UpdateScheduleBody {
  name?: string;
  daysMask?: number;
  startMin?: number;
  endMin?: number;
  enabled?: boolean;
  mode?: AppBlockScheduleMode;
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

  // ─── Schedules ─────────────────────────────────────────────────────────
  listSchedules: (childId: string) =>
    apiFetch<{ schedules: AppBlockScheduleDto[] }>(
      `/api/children/${childId}/app-control/schedules`,
    ),
  createSchedule: (childId: string, body: CreateScheduleBody) =>
    apiFetch<AppBlockScheduleDto>(`/api/children/${childId}/app-control/schedules`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSchedule: (childId: string, scheduleId: string, body: UpdateScheduleBody) =>
    apiFetch<AppBlockScheduleDto>(`/api/children/${childId}/app-control/schedules/${scheduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSchedule: (childId: string, scheduleId: string) =>
    apiFetch<void>(`/api/children/${childId}/app-control/schedules/${scheduleId}`, {
      method: 'DELETE',
    }),
};

// ─── Schedule helpers (для UI) ─────────────────────────────────────────────

export const ISO_WEEKDAY_LABELS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
export const DAYS_MASK_WEEKDAYS = 0b0011111; // 31
export const DAYS_MASK_WEEKEND = 0b1100000; // 96
export const DAYS_MASK_ALL = 0b1111111; // 127

/** Bit-маска → массив ISO weekday индексов (1..7). */
export function daysMaskToList(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    if ((mask & (1 << i)) !== 0) out.push(i + 1);
  }
  return out;
}

/** Человекочитаемое короткое описание дней. */
export function formatDaysMask(mask: number): string {
  if (mask === DAYS_MASK_ALL) return 'Каждый день';
  if (mask === DAYS_MASK_WEEKDAYS) return 'Будни';
  if (mask === DAYS_MASK_WEEKEND) return 'Выходные';
  return daysMaskToList(mask)
    .map((d) => ISO_WEEKDAY_LABELS_RU[d - 1])
    .join(', ');
}

/**
 * Активно ли расписание в момент `now` для устройства с TZ `tz`?
 * Реализация совпадает с backend ScheduleService.isActiveAt — нужна для
 * бейджа «Сейчас активно» на карточке. На сервере вычисляется при ответе,
 * но для real-time UI считаем на клиенте каждую минуту.
 */
export function isScheduleActiveAt(
  schedule: Pick<AppBlockScheduleDto, 'enabled' | 'daysMask' | 'startMin' | 'endMin'>,
  now: Date,
  tz: string,
): boolean {
  if (!schedule.enabled) return false;
  if (schedule.startMin === schedule.endMin) return false;
  const local = getLocalParts(now, tz);
  const todayBit = 1 << (local.weekday - 1);
  const yesterdayBit = 1 << ((local.weekday === 1 ? 7 : local.weekday - 1) - 1);
  if (schedule.startMin < schedule.endMin) {
    return (
      (schedule.daysMask & todayBit) !== 0 &&
      local.minute >= schedule.startMin &&
      local.minute < schedule.endMin
    );
  }
  const tail = (schedule.daysMask & yesterdayBit) !== 0 && local.minute < schedule.endMin;
  const head = (schedule.daysMask & todayBit) !== 0 && local.minute >= schedule.startMin;
  return tail || head;
}

interface LocalParts {
  weekday: number;
  minute: number;
}

function getLocalParts(now: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  let weekdayStr = '';
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'weekday') weekdayStr = p.value;
    else if (p.type === 'hour') hour = Number.parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = Number.parseInt(p.value, 10);
  }
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { weekday: map[weekdayStr] ?? 1, minute: hour * 60 + minute };
}

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
