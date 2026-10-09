import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { snapTrack } from './road-snap';
import type {
  MatchPoint,
  OsrmClient,
  OsrmMatchResponse,
  OsrmRouteResponse,
  SnapInputPoint,
  SnapResult,
  TravelMode,
} from './road-snap';

// Ответы OSRM кэшируются по входу запроса: трек дня и активная поездка
// перезапрашиваются каждые 10–30 с, а меняется у них только хвост.
const CACHE_SIZE = 3000;
const TIMEOUT_MS = 4000;
// После сетевой ошибки не долбим OSRM — минуту отдаём треки без привязки.
const BACKOFF_MS = 60_000;

/**
 * v0.80.0 — привязка треков к дорогам. Два osrm-routed: граф car и граф foot
 * (OSRM_CAR_URL / OSRM_FOOT_URL, контейнеры gmd-osrm-*). Без адресов функция
 * выключена: snap() отдаёт null, вызывающие рисуют очищенный трек как раньше.
 */
@Injectable()
export class RoadMatchService implements OsrmClient {
  private readonly logger = new Logger(RoadMatchService.name);
  private readonly urls: Record<TravelMode, string | undefined> = {
    car: process.env.OSRM_CAR_URL?.replace(/\/+$/, '') || undefined,
    foot: process.env.OSRM_FOOT_URL?.replace(/\/+$/, '') || undefined,
  };
  private readonly cache = new Map<string, unknown>();
  private downUntil = 0;

  enabled(): boolean {
    return Boolean(this.urls.car && this.urls.foot);
  }

  /** null — привязка выключена или OSRM недоступен. */
  async snap(points: SnapInputPoint[]): Promise<SnapResult | null> {
    if (!this.enabled() || Date.now() < this.downUntil || points.length < 2) return null;
    return snapTrack(points, this);
  }

  async match(mode: TravelMode, points: MatchPoint[]): Promise<OsrmMatchResponse | null> {
    // OSRM требует неубывающие timestamps в секундах.
    const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const ts = points.map((p) => Math.floor(p.t / 1000)).join(';');
    const radiuses = points.map((p) => p.radius.toFixed(1)).join(';');
    const query =
      `timestamps=${ts}&radiuses=${radiuses}` +
      '&steps=true&geometries=geojson&overview=false&gaps=ignore';
    return this.get<OsrmMatchResponse>(mode, `/match/v1/${mode}/${coords}?${query}`);
  }

  async route(
    mode: TravelMode,
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ): Promise<OsrmRouteResponse | null> {
    const coords = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`;
    return this.get<OsrmRouteResponse>(
      mode,
      `/route/v1/${mode}/${coords}?overview=full&geometries=geojson&alternatives=false`,
    );
  }

  private async get<T>(mode: TravelMode, path: string): Promise<T | null> {
    const base = this.urls[mode];
    if (!base || Date.now() < this.downUntil) return null;
    const key = createHash('sha1').update(`${mode}${path}`).digest('base64');
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // LRU: свежий доступ — в конец очереди вытеснения.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit as T;
    }
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      // 400 с code NoMatch/NoRoute/NoSegment — нормальный ответ «не нашлось».
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as T;
      this.cache.set(key, body);
      if (this.cache.size > CACHE_SIZE) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return body;
    } catch (err) {
      this.downUntil = Date.now() + BACKOFF_MS;
      this.logger.warn(
        `osrm ${mode} unavailable, road matching paused for ${BACKOFF_MS / 1000}s: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
