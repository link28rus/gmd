/**
 * v0.60: настройки журнала приложения ребёнка (DiagConfig).
 * Контракт — docs/superpowers/specs/2026-09-29-child-diag-logs.md.
 *
 * Хранятся в `child_devices.diagConfig` (JSONB, null = умолчания). Телефон
 * получает их по мгновенному каналу (`DIAG_CONFIG`) и через
 * `GET /child/diag/config` — всегда нормализованными, с подставленными
 * умолчаниями, чтобы ему не приходилось гадать о пропущенных полях.
 */

export const DIAG_CATEGORIES = [
  'audio',
  'location',
  'realtime',
  'push',
  'update',
  'system',
  'other',
] as const;

export type DiagCategory = (typeof DIAG_CATEGORIES)[number];

export interface DiagConfig {
  /** Какие категории попадают в отправляемый журнал. */
  send: DiagCategory[];
  /** Для каких категорий писать подробные (DEBUG) записи. */
  debug: DiagCategory[];
  /** ISO-время, после которого подробный режим сам выключается; null = бессрочно. */
  debugUntil: string | null;
  /** Прикладывать системный logcat своего процесса. */
  logcat: boolean;
  /** Прикладывать снимок состояния телефона. */
  snapshot: boolean;
  /** Сам отправлять журнал при сбоях. */
  autoUpload: boolean;
}

export const DEFAULT_DIAG_CONFIG: Readonly<DiagConfig> = Object.freeze({
  send: [...DIAG_CATEGORIES],
  debug: [],
  debugUntil: null,
  logcat: false,
  snapshot: true,
  autoUpload: true,
});

const CATEGORY_SET: ReadonlySet<string> = new Set(DIAG_CATEGORIES);

/** Оставляет только известные категории, без повторов, в каноническом порядке. */
export function normalizeCategories(value: readonly unknown[]): DiagCategory[] {
  const present = new Set(
    value.filter((v): v is string => typeof v === 'string' && CATEGORY_SET.has(v)),
  );
  return DIAG_CATEGORIES.filter((c) => present.has(c));
}

function normalizeDebugUntil(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * JSONB (или что угодно) → полный DiagConfig. Отсутствующие/битые поля
 * заменяются умолчаниями, неизвестные категории отбрасываются.
 */
export function normalizeDiagConfig(raw: unknown): DiagConfig {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
  return {
    send: Array.isArray(src.send) ? normalizeCategories(src.send) : [...DEFAULT_DIAG_CONFIG.send],
    debug: Array.isArray(src.debug)
      ? normalizeCategories(src.debug)
      : [...DEFAULT_DIAG_CONFIG.debug],
    debugUntil: normalizeDebugUntil(src.debugUntil),
    logcat: bool(src.logcat, DEFAULT_DIAG_CONFIG.logcat),
    snapshot: bool(src.snapshot, DEFAULT_DIAG_CONFIG.snapshot),
    autoUpload: bool(src.autoUpload, DEFAULT_DIAG_CONFIG.autoUpload),
  };
}
