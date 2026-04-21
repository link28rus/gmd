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
  networkType: 'wifi' | 'mobile' | 'offline' | 'unknown' | null;
  wifiSsid: string | null;
  mobileOperator: string | null;
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

export interface TripDto {
  id: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  pointsCount: number;
  distanceM: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}

export interface TripPointDto {
  lat: number;
  lon: number;
  recordedAt: string;
}

export interface ActiveTrackDto {
  trip: TripDto | null;
  points: TripPointDto[];
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

  getActiveTrack: (childId: string) =>
    apiFetch<ActiveTrackDto>(`/api/children/${encodeURIComponent(childId)}/trips/active-track`),

  getTrips: (childId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return apiFetch<{ trips: TripDto[] }>(
      `/api/children/${encodeURIComponent(childId)}/trips${qs.toString() ? `?${qs}` : ''}`,
    );
  },

  getTripPoints: (childId: string, tripId: string) =>
    apiFetch<{ points: TripPointDto[] }>(
      `/api/children/${encodeURIComponent(childId)}/trips/${encodeURIComponent(tripId)}/points`,
    ),
};
