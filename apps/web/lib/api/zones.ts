// apps/web/lib/api/zones.ts
import { apiFetch } from './client';

export type ZoneState = 'inside' | 'outside' | 'unknown';

export interface Zone {
  id: string;
  familyId: string;
  name: string;
  lat: number;
  lon: number;
  radiusMeters: number;
  address: string | null;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
  lat: number;
  lon: number;
  radiusMeters: number;
  address?: string;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
  active?: boolean;
}

export interface UpdateZoneInput {
  name?: string;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  address?: string | null;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
  active?: boolean;
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
