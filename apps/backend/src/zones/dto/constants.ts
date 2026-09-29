export const ZONE_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#64748b',
] as const;

export const ZONE_ICONS = [
  'home',
  'school',
  'sport',
  'art',
  'hospital',
  'shop',
  'music',
  'other',
] as const;

export const MAX_ZONES_PER_FAMILY = 20;
// v0.64.0: минимум 100 м (Android рекомендует 100–150 м; 50 м давали ложные
// «ушёл»). CHECK в БД остаётся 50..5000 — старые зоны не ломаются.
export const MIN_RADIUS_M = 100;
export const DEFAULT_RADIUS_M = 150;
export const MAX_CHILDREN_PER_ZONE = 50;
export const MAX_RADIUS_M = 5000;
