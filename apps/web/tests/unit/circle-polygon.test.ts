import { circlePolygon } from '@/lib/geo/circle-polygon';

describe('circlePolygon', () => {
  it('возвращает 64 + замыкающую точку', () => {
    const poly = circlePolygon(55.75, 37.61, 10);
    expect(poly.length).toBe(65);
    expect(poly[0]).toEqual(poly[64]);
  });

  it('точки лежат на окружности радиуса ±5%', () => {
    const lat = 55.75;
    const lon = 37.61;
    const r = 100;
    const poly = circlePolygon(lat, lon, r);
    for (const [plon, plat] of poly.slice(0, 64)) {
      const dy = (plat - lat) * 111_320;
      const dx = (plon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeGreaterThan(r * 0.95);
      expect(dist).toBeLessThan(r * 1.05);
    }
  });
});
