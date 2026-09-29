// apps/web/lib/admin/diag.ts
// Чистые функции админ-страницы «Журнал приложения ребёнка» (v0.60.0).
// Спецификация: docs/superpowers/specs/2026-09-29-child-diag-logs.md
import type { DiagCategory, DiagConfig, DiagUploadDetail, DiagUploadRow } from '@/lib/api/admin';

export const DIAG_CATEGORY_LABEL: Record<DiagCategory, string> = {
  audio: 'Звук вокруг и сигнал',
  location: 'Геолокация',
  realtime: 'Мгновенный канал',
  push: 'Push и команды',
  update: 'Обновления',
  system: 'Система',
  other: 'Прочее',
};

/** Минимальная версия приложения ребёнка, которая понимает UPLOAD_DIAG / DIAG_CONFIG. */
export const MIN_DIAG_APP_VERSION = '0.60.0';

/** «0.60.0+6100» → [0, 60, 0]; null, если версия не распознана. */
export function parseAppVersion(v: string | null | undefined): [number, number, number] | null {
  if (!v) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** true/false — поддерживает ли версия журнал на сервере; null — версия неизвестна. */
export function supportsDiag(appVersion: string | null | undefined): boolean | null {
  const v = parseAppVersion(appVersion);
  const min = parseAppVersion(MIN_DIAG_APP_VERSION) as [number, number, number];
  if (!v) return null;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

// ─── Срок подробного режима ──────────────────────────────────────────────────

/** `keep` — оставить текущий `debugUntil` без изменений. */
export type DebugDuration = 'keep' | '1h' | '24h' | '3d' | 'none';

export const DEBUG_DURATION_MS: Record<'1h' | '24h' | '3d', number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
};

export const DEBUG_DURATION_LABEL: Record<Exclude<DebugDuration, 'keep'>, string> = {
  '1h': '1 час',
  '24h': '24 часа',
  '3d': '3 дня',
  none: 'Без срока',
};

/** Выбор в селекте срока по сохранённым настройкам. */
export function initialDebugDuration(config: DiagConfig): DebugDuration {
  if (config.debugUntil) return 'keep';
  return config.debug.length > 0 ? 'none' : '24h';
}

/** Значение `debugUntil` для отправки на сервер. */
export function resolveDebugUntil(
  choice: DebugDuration,
  current: string | null,
  now: number,
): string | null {
  if (choice === 'keep') return current;
  if (choice === 'none') return null;
  return new Date(now + DEBUG_DURATION_MS[choice]).toISOString();
}

export type DebugState =
  | { kind: 'off' }
  | { kind: 'forever' }
  | { kind: 'until'; until: Date }
  | { kind: 'expired'; until: Date };

/** Действует ли подробный режим: категория в `debug` и (`debugUntil == null` или now < debugUntil). */
export function debugState(config: DiagConfig, now: number): DebugState {
  if (config.debug.length === 0) return { kind: 'off' };
  if (!config.debugUntil) return { kind: 'forever' };
  const until = new Date(config.debugUntil);
  if (Number.isNaN(until.getTime())) return { kind: 'forever' };
  return now < until.getTime() ? { kind: 'until', until } : { kind: 'expired', until };
}

/** Убрать дубли и выстроить категории в каноническом порядке. */
export function normalizeCategories(
  list: readonly DiagCategory[],
  order: readonly DiagCategory[],
): DiagCategory[] {
  return order.filter((c) => list.includes(c));
}

// ─── Строки журнала ──────────────────────────────────────────────────────────

export type LogLevelFilter = 'all' | 'I' | 'D';

/** Строка журнала: `MM-dd HH:mm:ss.SSS L [tag] msg`, L — I или D. */
const LOG_LINE_RE = /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} ([A-Z]) /;

/**
 * Фильтр строк по подстроке (без учёта регистра) и уровню. Строки-продолжения
 * (стектрейсы, многострочные сообщения) наследуют уровень предыдущей записи.
 */
export function filterLogLines(
  text: string,
  query: string,
  level: LogLevelFilter,
): { lines: string[]; total: number } {
  const all = text.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  const q = query.trim().toLowerCase();
  let current: string | null = null;
  const lines: string[] = [];
  for (const line of all) {
    const m = LOG_LINE_RE.exec(line);
    if (m) current = m[1] ?? null;
    if (level !== 'all' && current !== level) continue;
    if (q && !line.toLowerCase().includes(q)) continue;
    lines.push(line);
  }
  return { lines, total: all.length };
}

// ─── Отображение ─────────────────────────────────────────────────────────────

export function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} КБ`;
}

export function uploadReasonLabel(row: Pick<DiagUploadRow, 'reason' | 'trigger'>): string {
  return row.reason === 'manual' ? 'По запросу' : `Автоматически: ${row.trigger ?? '—'}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru');
}

/** Снимок состояния — если это JSON, показываем с отступами. */
export function prettySnapshot(snapshot: string): string {
  const t = snapshot.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return snapshot;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return snapshot;
  }
}

/** Весь журнал одним текстом для «Скачать .txt». */
export function buildDiagTxt(d: DiagUploadDetail): string {
  const section = (title: string, body: string | null): string =>
    `===== ${title} =====\n${body && body.length > 0 ? body : '(нет данных)'}\n`;
  const header = [
    'Журнал приложения ребёнка (Перископ)',
    `id: ${d.id}`,
    `ребёнок: ${d.childId}`,
    `получен: ${d.createdAt}`,
    `причина: ${uploadReasonLabel(d)}`,
    `команда: ${d.commandId ?? '—'}`,
    `версия приложения: ${d.appVersion ?? '—'}`,
    `размер: ${formatSize(d.sizeBytes)}`,
    '',
  ].join('\n');
  return [
    header,
    section('Снимок состояния', d.snapshot ? prettySnapshot(d.snapshot) : null),
    section('Журнал', d.log),
    section('logcat', d.logcat),
  ].join('\n');
}

export function diagFileName(d: Pick<DiagUploadDetail, 'childId' | 'createdAt'>): string {
  const stamp = d.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  return `periscop-diag-${d.childId.slice(0, 8)}-${stamp}.txt`;
}
