// apps/web/lib/maps/marker-spread.ts
//
// Веер меток на общей карте семьи (порт mobile-parent/.../marker_spread.dart,
// v0.86.0). Метки людей — аватар с подписью шириной до ~96 px. Когда двое
// стоят рядом (родитель забрал ребёнка), подписи налезают и одну метку не
// видно. Как в картах с «паучком» (spiderfy): налезающие метки раздвигаются
// по кругу вокруг их общей середины, к настоящему месту каждой ведёт тонкая
// линия. Расчёт в пикселях текущего зума — при отдалении веер собирает больше
// людей, при приближении расходится сам.

/** Метки ближе этого по обеим осям (px) налезают друг на друга. */
export const SPREAD_OVERLAP_DX = 84;
export const SPREAD_OVERLAP_DY = 60;

/** Расстояние между соседями в веере (px) — больше ширины подписи. */
export const SPREAD_GAP = 100;

export interface SpreadLatLng {
  lat: number;
  lon: number;
}

interface Pixel {
  x: number;
  y: number;
}

/**
 * Проектор пиксель↔координата в пикселях ТЕКУЩЕГО зума (EPSG3857). В
 * компоненте — обёртка над `map.project` / `map.unproject`; в тестах — свой
 * меркатор. Веер зависит только от зума: пиксельная разница между двумя
 * точками инвариантна к сдвигу карты.
 */
export interface SpreadProjector {
  toPixel(p: SpreadLatLng): Pixel;
  toLatLng(px: Pixel): SpreadLatLng;
}

/**
 * Возвращает новые позиции только для разведённых меток (ключ → точка).
 * Одиночные метки в ответ не попадают — их рисуют на месте.
 */
export function spreadMarkers(
  points: Map<string, SpreadLatLng>,
  proj: SpreadProjector,
): Map<string, SpreadLatLng> {
  const out = new Map<string, SpreadLatLng>();
  if (points.size < 2) return out;

  // Сортировка ключей — порядок в веере не прыгает между обновлениями.
  const keys = [...points.keys()].sort();
  const px = keys.map((k) => proj.toPixel(points.get(k) as SpreadLatLng));

  // Группы налезающих меток (union-find: цепочка соседей — одна группа).
  const parent = keys.map((_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (
        Math.abs(px[i].x - px[j].x) < SPREAD_OVERLAP_DX &&
        Math.abs(px[i].y - px[j].y) < SPREAD_OVERLAP_DY
      ) {
        parent[find(i)] = find(j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < keys.length; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  for (const g of groups.values()) {
    const n = g.length;
    if (n < 2) continue;
    let cx = 0;
    let cy = 0;
    for (const i of g) {
      cx += px[i].x;
      cy += px[i].y;
    }
    cx /= n;
    cy /= n;
    // Двое — слева и справа; больше — по кругу, начиная сверху.
    const radius = n === 2 ? SPREAD_GAP / 2 : SPREAD_GAP / (2 * Math.sin(Math.PI / n));
    const start = n === 2 ? Math.PI : -Math.PI / 2;
    for (let k = 0; k < n; k++) {
      const a = start + (2 * Math.PI * k) / n;
      out.set(
        keys[g[k]],
        proj.toLatLng({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }),
      );
    }
  }

  return out;
}
