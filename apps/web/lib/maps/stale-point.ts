// apps/web/lib/maps/stale-point.ts

/**
 * Точка старше 10 минут — «несвежая»: метку на карте рисуем серой
 * (дети и родители, общая карта семьи и карта ребёнка).
 */
export const STALE_POINT_SEC = 600;

export function isStalePoint(ageSec: number): boolean {
  return ageSec > STALE_POINT_SEC;
}
