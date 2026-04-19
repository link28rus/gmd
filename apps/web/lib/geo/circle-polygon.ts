// apps/web/lib/geo/circle-polygon.ts

const METERS_PER_DEG_LAT = 111_320;

/**
 * Аппроксимация окружности радиуса r (метры) вокруг (lat, lon) — 64 сегмента.
 * Возвращает массив [lon, lat] (формат GeoJSON) + замыкающая точка = первая.
 */
export function circlePolygon(
  lat: number,
  lon: number,
  radiusMeters: number,
  segments = 64,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const latRad = (lat * Math.PI) / 180;
  const dLat = radiusMeters / METERS_PER_DEG_LAT;
  const dLon = radiusMeters / (METERS_PER_DEG_LAT * Math.cos(latRad));
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  out.push([...out[0]] as [number, number]);
  return out;
}
