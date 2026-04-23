// apps/web/lib/geo/douglas-peucker.ts
// Ramer–Douglas–Peucker упрощение полилинии.
//
// Используется в TrackPolyline чтобы вычистить GPS-шум: точки-дрожания
// (accuracy 30-80м при стоянке внутри здания) сжимаются в одну, линия
// между реальными движениями остаётся.
//
// Формат точек — [lon, lat] (GeoJSON), как и везде в web/map-коде.

const METERS_PER_DEG_LAT = 111_320;

/** Расстояние между двумя точками в метрах (haversine, точность ±0.5% на <1km). */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

/**
 * Перпендикулярное расстояние от точки p до отрезка (a, b) в метрах.
 * Работаем в equirectangular-проекции (cos-коррекция по широте) — достаточно
 * точно для шкалы треков (до сотен метров) и избавляет от тригонометрии
 * внутри рекурсии.
 */
function perpDistanceMeters(p: [number, number], a: [number, number], b: [number, number]): number {
  // Берём широту отрезка для cos-коррекции долготы.
  const refLat = (a[1] + b[1]) / 2;
  const kLat = METERS_PER_DEG_LAT;
  const kLon = METERS_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  const px = p[0] * kLon;
  const py = p[1] * kLat;
  const ax = a[0] * kLon;
  const ay = a[1] * kLat;
  const bx = b[0] * kLon;
  const by = b[1] * kLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Упрощает полилинию по Ramer–Douglas–Peucker.
 *
 * @param points   исходная последовательность [lon, lat]
 * @param epsilonM порог: точки с perp-расстоянием меньше epsilonM выбрасываются
 * @returns        упрощённая подпоследовательность (включая первую и последнюю)
 */
export function douglasPeucker(
  points: Array<[number, number]>,
  epsilonM = 10,
): Array<[number, number]> {
  if (points.length <= 2) return points.slice();
  // Итеративная реализация вместо рекурсии — стек чище, и нет риска упереться
  // в stack overflow при треках на 10К+ точек.
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxD = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistanceMeters(points[i], points[start], points[end]);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (maxD > epsilonM && index !== -1) {
      keep[index] = 1;
      stack.push([start, index]);
      stack.push([index, end]);
    }
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

export { distanceMeters };
