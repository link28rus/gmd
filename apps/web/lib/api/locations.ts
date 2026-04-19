// apps/web/lib/api/locations.ts
import { apiFetch } from './client';

export interface LatestLocationDto {
  lat: number;
  lon: number;
  recordedAt: string;
  serverReceivedAt: string;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  provider: 'gps' | 'fused' | 'network' | null;
  ageSec: number;
}

export interface LocationDto {
  lat: number;
  lon: number;
  recordedAt: string;
  accuracy: number | null;
  speed: number | null;
}

export interface LocationHistoryDto {
  items: LocationDto[];
  nextCursor: string | null;
}

export const locationsApi = {
  getLatest: (childId: string) =>
    apiFetch<LatestLocationDto | null>(
      `/api/children/${encodeURIComponent(childId)}/location/latest`,
    ),

  getHistory: (childId: string, from: string, to: string, limit = 2000) => {
    const qs = new URLSearchParams({
      from,
      to,
      order: 'asc',
      limit: String(limit),
    });
    return apiFetch<LocationHistoryDto>(
      `/api/children/${encodeURIComponent(childId)}/location/history?${qs.toString()}`,
    );
  },
};
