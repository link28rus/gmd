// apps/web/lib/api/locations.ts
import { apiFetch } from './client';

/**
 * v0.80.0: вид трека — привязан к дорогам (road, по умолчанию на backend) или
 * «как записано» (recorded: у детей очищенный трек, у телефона родителя сырые точки).
 */
export type TrackView = 'road' | 'recorded';

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
  /**
   * v0.80.0: точка достроена сервером по дороге в разрыве без данных (только
   * в режиме view=road). Время интерполировано.
   */
  inferred?: boolean;
}

export interface LocationHistoryDto {
  items: LocationDto[];
  nextCursor: string | null;
  /** v0.63.0: стоянки за период (трек уже очищен и свёрнут сервером). */
  stays?: StayDto[];
}

/** v0.63.0: стоянка на маршруте — ребёнок пробыл на месте несколько минут. */
export interface StayDto {
  lat: number;
  lon: number;
  from: string;
  to: string;
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
  /** v0.80.0: см. LocationDto.inferred. */
  inferred?: boolean;
}

export interface ActiveTrackDto {
  trip: TripDto | null;
  points: TripPointDto[];
  stays?: StayDto[];
}

/** Геозоны v2: последняя хорошая точка ребёнка (без outlier и mock). */
export interface FamilyLatestItem {
  childId: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  ageSec: number;
}

/** v0.70.0: последняя точка родителя семьи (общая карта). */
export interface FamilyLatestParent {
  userId: string;
  name: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  ageSec: number;
  /** Это текущий пользователь — подпись «Вы». */
  isMe: boolean;
}

export interface FamilyLatestResponse {
  items: FamilyLatestItem[];
  /** v0.70.0; у старого backend ключа нет — трактуем как пустой массив. */
  parents?: FamilyLatestParent[];
}

export const locationsApi = {
  /** Последние точки всех детей (и родителей, v0.70.0) семьи одним запросом; без точек не попадают. */
  getFamilyLatest: () => apiFetch<FamilyLatestResponse>('/api/family/locations/latest'),

  getLatest: (childId: string) =>
    apiFetch<LatestLocationDto | null>(
      `/api/children/${encodeURIComponent(childId)}/location/latest`,
    ),

  // v0.80.0: view — трек по дорогам (road, по умолчанию) или «как записано».
  getHistory: (
    childId: string,
    from: string,
    to: string,
    limit = 2000,
    view: TrackView = 'road',
  ) => {
    const qs = new URLSearchParams({
      from,
      to,
      order: 'asc',
      limit: String(limit),
      view,
    });
    return apiFetch<LocationHistoryDto>(
      `/api/children/${encodeURIComponent(childId)}/location/history?${qs.toString()}`,
    );
  },

  getActiveTrack: (childId: string, view: TrackView = 'road') =>
    apiFetch<ActiveTrackDto>(
      `/api/children/${encodeURIComponent(childId)}/trips/active-track?view=${view}`,
    ),

  getTrips: (childId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return apiFetch<{ trips: TripDto[] }>(
      `/api/children/${encodeURIComponent(childId)}/trips${qs.toString() ? `?${qs}` : ''}`,
    );
  },

  getTripPoints: (childId: string, tripId: string, view: TrackView = 'road') =>
    apiFetch<{ points: TripPointDto[]; stays?: StayDto[] }>(
      `/api/children/${encodeURIComponent(childId)}/trips/${encodeURIComponent(tripId)}/points?view=${view}`,
    ),
};
