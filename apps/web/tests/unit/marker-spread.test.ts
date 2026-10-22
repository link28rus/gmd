import {
  spreadMarkers,
  SPREAD_GAP,
  type SpreadLatLng,
  type SpreadProjector,
} from '@/lib/maps/marker-spread';

// Меркатор EPSG3857 как у Leaflet `map.project(latlng, zoom)` — чтобы тест
// повторял Dart-спеку (apps/mobile-parent/test/unit/marker_spread_test.dart).
function mercator(zoom: number): SpreadProjector {
  const scale = 256 * 2 ** zoom;
  return {
    toPixel: ({ lat, lon }) => {
      const s = Math.sin((lat * Math.PI) / 180);
      return {
        x: ((lon + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
      };
    },
    toLatLng: ({ x, y }) => {
      const n = Math.PI - (2 * Math.PI * y) / scale;
      return {
        lon: (x / scale) * 360 - 180,
        lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
      };
    },
  };
}

const m16 = mercator(16);
const pxDist = (a: SpreadLatLng, b: SpreadLatLng, proj = m16): number => {
  const pa = proj.toPixel(a);
  const pb = proj.toPixel(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
};
const pts = (o: Record<string, SpreadLatLng>): Map<string, SpreadLatLng> =>
  new Map(Object.entries(o));

describe('spreadMarkers', () => {
  it('меньше двух меток — ничего не двигаем', () => {
    expect(spreadMarkers(pts({}), m16).size).toBe(0);
    expect(spreadMarkers(pts({ a: { lat: 55, lon: 37 } }), m16).size).toBe(0);
  });

  it('далёкие метки остаются на месте', () => {
    const r = spreadMarkers(pts({ a: { lat: 55, lon: 37 }, b: { lat: 55.01, lon: 37.01 } }), m16);
    expect(r.size).toBe(0);
  });

  it('двое в одной точке — слева и справа, на ширину подписи', () => {
    const p = { lat: 48.48, lon: 135.08 };
    const r = spreadMarkers(pts({ 'kid:1': p, 'parent:u': p }), m16);
    expect([...r.keys()].sort()).toEqual(['kid:1', 'parent:u']);
    const kid = r.get('kid:1') as SpreadLatLng;
    const par = r.get('parent:u') as SpreadLatLng;
    expect(pxDist(kid, par)).toBeCloseTo(SPREAD_GAP, 0);
    // По горизонтали: широта одинаковая.
    expect(kid.lat).toBeCloseTo(par.lat, 9);
    // Середина — исходная точка.
    expect(pxDist(kid, p)).toBeCloseTo(SPREAD_GAP / 2, 0);
  });

  it('трое рядом — по кругу, соседи не ближе SPREAD_GAP', () => {
    const r = spreadMarkers(
      pts({
        a: { lat: 48.48, lon: 135.08 },
        b: { lat: 48.48001, lon: 135.08001 },
        c: { lat: 48.47999, lon: 135.08002 },
      }),
      m16,
    );
    expect(r.size).toBe(3);
    const v = [...r.values()];
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        expect(pxDist(v[i], v[j])).toBeGreaterThanOrEqual(SPREAD_GAP - 0.5);
      }
    }
  });

  it('порядок не зависит от порядка входа', () => {
    const p = { lat: 48.48, lon: 135.08 };
    const r1 = spreadMarkers(pts({ a: p, b: p }), m16);
    const r2 = spreadMarkers(pts({ b: p, a: p }), m16);
    expect(r1.get('a')).toEqual(r2.get('a'));
    expect(r1.get('b')).toEqual(r2.get('b'));
  });

  it('при отдалении близкие метки собираются в веер, при приближении — нет', () => {
    const p = pts({ a: { lat: 48.48, lon: 135.08 }, b: { lat: 48.48, lon: 135.0815 } });
    expect(spreadMarkers(p, mercator(18)).size).toBe(0);
    expect(spreadMarkers(p, mercator(13)).size).toBe(2);
  });
});
