// apps/web/lib/api/geocode.ts
import { apiFetch } from './client';

export interface GeocodeHit {
  name: string;
  description: string;
  lat: number;
  lon: number;
}

const cache = new Map<string, GeocodeHit[]>();

export async function geocode(q: string): Promise<GeocodeHit[]> {
  const key = q.trim().toLowerCase();
  if (!key || key.length < 2) return [];
  if (cache.has(key)) return cache.get(key)!;
  try {
    const data = await apiFetch<{ items?: GeocodeHit[] }>(
      `/api/geocode?q=${encodeURIComponent(q)}`,
    );
    const items = data.items ?? [];
    cache.set(key, items);
    return items;
  } catch {
    return [];
  }
}

export function clearGeocodeCache(): void {
  cache.clear();
}
