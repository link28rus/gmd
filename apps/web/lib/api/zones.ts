// apps/web/lib/api/zones.ts
import { apiFetch } from './client';

export type ZoneColor = '#22c55e' | '#3b82f6' | '#f59e0b' | '#ef4444' | '#a855f7' | '#64748b';

export type ZoneIcon =
  | 'home'
  | 'school'
  | 'sport'
  | 'art'
  | 'hospital'
  | 'shop'
  | 'music'
  | 'other';

export interface Zone {
  id: string;
  familyId: string;
  name: string;
  color: ZoneColor;
  icon: ZoneIcon;
  centerLat: number;
  centerLon: number;
  radius: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  childIds: string[];
  states?: Array<{ childId: string; isInside: boolean }>;
  /** Legacy alias kept for ZonesList display compat */
  active?: boolean;
  address?: string | null;
  radiusMeters?: number;
}

export interface ZoneEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  childId: string;
  childName: string;
  eventType: 'entry' | 'exit';
  occurredAt: string;
}

export interface CreateZoneInput {
  name: string;
  color: ZoneColor;
  icon: ZoneIcon;
  centerLat: number;
  centerLon: number;
  radius: number;
  childIds?: string[];
}

export interface UpdateZoneInput {
  name?: string;
  color?: ZoneColor;
  icon?: ZoneIcon;
  centerLat?: number;
  centerLon?: number;
  radius?: number;
  childIds?: string[];
}

export interface ListEventsQuery {
  childId?: string;
  zoneId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ZoneEventsPage {
  items: ZoneEvent[];
  nextCursor: string | null;
}

export const zonesApi = {
  list: () => apiFetch<Zone[]>('/api/zones'),

  create: (input: CreateZoneInput) =>
    apiFetch<Zone>('/api/zones', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  get: (id: string) => apiFetch<Zone>(`/api/zones/${encodeURIComponent(id)}`),

  update: (id: string, input: UpdateZoneInput) =>
    apiFetch<Zone>(`/api/zones/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  remove: (id: string) =>
    apiFetch<void>(`/api/zones/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listEvents: (q: ListEventsQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    return apiFetch<ZoneEventsPage>(`/api/zones/events${qs ? `?${qs}` : ''}`);
  },
};
