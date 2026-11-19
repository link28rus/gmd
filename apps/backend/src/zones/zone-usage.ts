import { USAGE_WINDOW_MS, UsageSegmentsSchema } from '../app-control/dto/usage-report.dto';
import { tzOffsetMs, type ZoneVisit } from './place-insights';

const DAY_MS = 86_400_000;

/** Первый UTC-момент календарного дня. Учитывает смену смещения, в том числе в полночь. */
export function zonePeriodStart(now: number, tz: string, days: number): number {
  const localDay = (at: number) => Math.floor((at + tzOffsetMs(at, tz)) / DAY_MS);
  const target = localDay(now) - (days - 1);
  let before = (target - 1) * DAY_MS;
  let after = (target + 1) * DAY_MS;
  while (after - before > 1) {
    const mid = Math.floor((before + after) / 2);
    if (localDay(mid) < target) before = mid;
    else after = mid;
  }
  return after;
}

export function clipVisits(visits: ZoneVisit[], from: number, to: number): ZoneVisit[] {
  return visits
    .map((visit) => ({ ...visit, from: Math.max(visit.from, from), to: Math.min(visit.to, to) }))
    .filter((visit) => visit.from < visit.to);
}

interface UsageWindow {
  startMs: number;
  segments: unknown;
}

interface ZoneUsage {
  coverage: 'none' | 'partial' | 'complete';
  totalSec: number;
  apps: Array<{ packageName: string; seconds: number }>;
}

/** Визиты и уникальные UTC-окна отсортированы по времени. */
export function summarizeZoneUsage(visits: ZoneVisit[], windows: UsageWindow[]): ZoneUsage {
  const totals = new Map<string, number>();
  let coveredMs = 0;
  let firstWindow = 0;
  for (const visit of visits) {
    while (
      firstWindow < windows.length &&
      windows[firstWindow].startMs + USAGE_WINDOW_MS <= visit.from
    ) {
      firstWindow++;
    }
    for (let i = firstWindow; i < windows.length && windows[i].startMs < visit.to; i++) {
      const { startMs, segments } = windows[i];
      const parsed = UsageSegmentsSchema.safeParse(segments);
      if (!parsed.success) continue;
      const from = Math.max(visit.from - startMs, 0);
      const to = Math.min(visit.to - startMs, USAGE_WINDOW_MS);
      coveredMs += to - from;
      for (const [packageName, segmentFrom, segmentTo] of parsed.data) {
        const ms = Math.min(to, segmentTo) - Math.max(from, segmentFrom);
        if (ms > 0) totals.set(packageName, (totals.get(packageName) ?? 0) + ms);
      }
    }
  }
  const expectedMs = visits.reduce((total, visit) => total + visit.to - visit.from, 0);
  const apps = Array.from(totals, ([packageName, ms]) => ({
    packageName,
    seconds: Math.round(ms / 1000),
  }))
    .filter((app) => app.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || a.packageName.localeCompare(b.packageName));
  return {
    coverage: coveredMs === 0 ? 'none' : coveredMs < expectedMs ? 'partial' : 'complete',
    totalSec: Math.round(Array.from(totals.values()).reduce((sum, ms) => sum + ms, 0) / 1000),
    apps,
  };
}
