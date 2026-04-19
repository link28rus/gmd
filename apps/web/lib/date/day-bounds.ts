// apps/web/lib/date/day-bounds.ts

export function todayIso(): string {
  return toYmd(new Date());
}

export function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYmd(d);
}

export function isToday(ymd: string): boolean {
  return ymd === todayIso();
}

/**
 * Границы дня YYYY-MM-DD в локальной TZ браузера, сериализованные в UTC ISO.
 */
export function dayBoundsIso(ymd: string): [string, string] {
  const [y, m, d] = ymd.split('-').map(Number);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d, 23, 59, 59, 999);
  return [from.toISOString(), to.toISOString()];
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
