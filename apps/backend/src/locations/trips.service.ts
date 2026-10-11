import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppSettingsService,
  SETTINGS_KEYS,
  TRACK_DEFAULTS,
} from '../app-settings/app-settings.service';
import { RoadMatchService } from '../road-match/road-match.service';
import { buildTrack, pathLength, segmentTrips } from './track-builder';
import type { TrackInputPoint, TrackOutPoint, TrackParams } from './track-builder';

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_IDLE_RADIUS_M = 70;
// Трек за произвольный период (карта дня) — не больше стольких точек.
const TRACK_MAX_POINTS = 5000;
// v0.80.0: сколько поездок за один пересчёт привязывать к дорогам впервые.
// Пересчёт идёт после каждой выгрузки точек; после деплоя или простоя OSRM
// непривязанные поездки за 30 дней догоняются порциями, не задерживая push.
const ROAD_MATCH_TRIPS_PER_RECOMPUTE = 10;
// Окно пересчёта поездок = retention точек (pg_cron, 30 дней).
const TRIPS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type DbClient = Prisma.TransactionClient | PrismaService;

interface ExistingTrip {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
}

// Те же границы и число точек — та же нарезка поездки (ключ кэша пробега).
function segKey(t: { startedAt: number; endedAt: number; pointsCount: number }): string {
  return `${t.startedAt}|${t.endedAt}|${t.pointsCount}`;
}

interface TripFields {
  startedAt: Date;
  endedAt: Date | null;
  isActive: boolean;
  pointsCount: number;
  distanceM: number;
  roadMatched: boolean;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}

// Пересчёт не трогает строку, если ничего не поменялось (updatedAt не дёргаем).
function sameTrip(a: TripFields, b: TripFields): boolean {
  return (
    a.startedAt.getTime() === b.startedAt.getTime() &&
    (a.endedAt?.getTime() ?? null) === (b.endedAt?.getTime() ?? null) &&
    a.isActive === b.isActive &&
    a.pointsCount === b.pointsCount &&
    a.distanceM === b.distanceM &&
    a.roadMatched === b.roadMatched &&
    a.startLat === b.startLat &&
    a.startLon === b.startLon &&
    a.endLat === b.endLat &&
    a.endLon === b.endLon
  );
}

/**
 * Аудит 2026-10-12: сопоставление пересчитанных поездок с сохранёнными, чтобы id
 * поездки (его держат кабинет и приложение родителя) переживал пересчёт.
 *
 * Идентичность поездки — её начало (момент отъезда со стоянки): новые точки в
 * хвосте двигают конец активной поездки и закрывают её, но не начало.
 * 1. Точное совпадение startedAt — основной случай.
 * 2. Остальные — по пересечению интервалов, ближайшие по началу первыми:
 *    начало сдвигается, если точки пришли задним числом (офлайн-хвост),
 *    если поменялась разметка плохих точек или старейшая поездка частично
 *    ушла за окно 30 дней. Интервал незакрытой сохранённой поездки — до now.
 * Сопоставление один к одному; сохранённые без пары удаляются.
 * Возвращает id сохранённой поездки для каждой пересчитанной (или undefined).
 */
export function matchTrips(
  existing: ExistingTrip[],
  fresh: Array<{ startedAt: number; endedAt: number }>,
  now: number,
): Array<string | undefined> {
  const out = new Array<string | undefined>(fresh.length).fill(undefined);
  const used = new Set<string>();
  const byStart = new Map<number, string>();
  for (const e of existing) {
    const k = e.startedAt.getTime();
    if (!byStart.has(k)) byStart.set(k, e.id);
  }
  fresh.forEach((f, i) => {
    const id = byStart.get(f.startedAt);
    if (id && !used.has(id)) {
      out[i] = id;
      used.add(id);
    }
  });
  const pairs: Array<{ i: number; id: string; d: number }> = [];
  fresh.forEach((f, i) => {
    if (out[i]) return;
    for (const e of existing) {
      if (used.has(e.id)) continue;
      const eStart = e.startedAt.getTime();
      const eEnd = e.endedAt?.getTime() ?? Math.max(now, eStart);
      if (eStart <= f.endedAt && f.startedAt <= eEnd) {
        pairs.push({ i, id: e.id, d: Math.abs(eStart - f.startedAt) });
      }
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  for (const p of pairs) {
    if (out[p.i] || used.has(p.id)) continue;
    out[p.i] = p.id;
    used.add(p.id);
  }
  return out;
}

/** road — привязанный к дорогам (по умолчанию), recorded — «как записано». */
export type TrackView = 'road' | 'recorded';

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

export interface TrackPointDto {
  lat: number;
  lon: number;
  recordedAt: string;
  // v0.80.0: участок достроен по дороге в разрыве без данных (рисуется пунктиром).
  inferred?: true;
}

export interface TrackStayDto {
  lat: number;
  lon: number;
  from: string;
  to: string;
}

export interface TrackDto {
  points: TrackPointDto[];
  stays: TrackStayDto[];
}

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(RoadMatchService) private readonly road: RoadMatchService,
  ) {}

  private async params(): Promise<TrackParams> {
    const [idleMinutes, idleRadiusM, stopMinutes] = await Promise.all([
      this.settings.getNumber(SETTINGS_KEYS.TRIP_IDLE_MINUTES, DEFAULT_IDLE_MINUTES),
      this.settings.getNumber(SETTINGS_KEYS.TRIP_IDLE_RADIUS_M, DEFAULT_IDLE_RADIUS_M),
      this.settings.getNumber(SETTINGS_KEYS.TRACK_STOP_MINUTES, TRACK_DEFAULTS.stopMinutes),
    ]);
    return {
      idleMs: idleMinutes * 60_000,
      idleRadiusM,
      stopMinMs: stopMinutes * 60_000,
    };
  }

  // Хорошие точки ребёнка за период — только они идут в поездки и трек.
  // latest — при обрезке по take брать последние точки, а не первые: на карте
  // важнее, где ребёнок сейчас, чем начало слишком длинного периода.
  // Прореживание не берём: стоянки и разрывы «нет данных» считаются по
  // соседним точкам и времени, на разреженном ряду появились бы ложные.
  private async goodPoints(
    childId: string,
    from: Date,
    to?: Date,
    opts: { take?: number; latest?: boolean; db?: DbClient } = {},
  ) {
    const db = opts.db ?? this.prisma;
    const rows = await db.location.findMany({
      where: {
        childId,
        trackFlag: null,
        recordedAt: to ? { gte: from, lte: to } : { gte: from },
      },
      select: { lat: true, lon: true, recordedAt: true, accuracy: true },
      orderBy: { recordedAt: opts.latest ? 'desc' : 'asc' },
      take: opts.take,
    });
    if (opts.latest) rows.reverse();
    return rows.map(
      (r): TrackInputPoint => ({
        lat: r.lat,
        lon: r.lon,
        t: r.recordedAt.getTime(),
        accuracy: r.accuracy,
      }),
    );
  }

  // Пересчитывает все поездки ребёнка заново из точек. Грубо, но просто и
  // устойчиво к retroactive-правкам точек (офлайн-хвост, переразметка).
  // Вызывается:
  //   (а) сразу после каждого ingest — для онлайн-карты
  //   (б) из TrackBackfillService при смене правил разметки
  //
  // Аудит 2026-10-12:
  //  - id поездок стабильны: пересчитанные сопоставляются с сохранёнными
  //    (matchTrips), меняются только изменившиеся, удаляются исчезнувшие;
  //  - параллельные пересчёты (fire-and-forget после каждого ingest)
  //    сериализуются advisory-локом на ребёнка. OSRM — до лока; под локом
  //    сверяем, не изменились ли точки с момента чтения, и если да —
  //    перечитываем и нарезаем заново (дорожный пробег берём из посчитанного,
  //    для новых границ — по очищенному треку, догонится следующим пересчётом).
  async recomputeForChild(childId: string): Promise<void> {
    const p = await this.params();
    const since = new Date(Date.now() - TRIPS_WINDOW_MS);
    const points = await this.goodPoints(childId, since);
    const firstPass = segmentTrips(points, { ...p, now: Date.now() });
    const firstDistances = await this.roadDistances(childId, firstPass);
    const roadByKey = new Map<string, number>();
    firstPass.forEach((t, i) => {
      const d = firstDistances[i];
      if (d !== undefined) roadByKey.set(segKey(t), d);
    });

    const stats = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('trips'), hashtext(${childId}))::text`,
        );
        let trips = firstPass;
        const agg = await tx.location.aggregate({
          where: { childId, trackFlag: null, recordedAt: { gte: since } },
          _count: { _all: true },
          _max: { recordedAt: true },
        });
        const lastT = points.length > 0 ? points[points.length - 1].t : null;
        if (
          agg._count._all !== points.length ||
          (agg._max.recordedAt?.getTime() ?? null) !== lastT
        ) {
          const fresh = await this.goodPoints(childId, since, undefined, { db: tx });
          trips = segmentTrips(fresh, { ...p, now: Date.now() });
        }

        const existing = await tx.trip.findMany({
          where: { childId },
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            isActive: true,
            pointsCount: true,
            distanceM: true,
            roadMatched: true,
            startLat: true,
            startLon: true,
            endLat: true,
            endLon: true,
          },
        });
        const ids = matchTrips(existing, trips, Date.now());
        const byId = new Map(existing.map((e) => [e.id, e]));
        const keep = new Set(ids.filter((x): x is string => x !== undefined));
        const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
        if (gone.length > 0) await tx.trip.deleteMany({ where: { id: { in: gone } } });

        const toCreate: Prisma.TripCreateManyInput[] = [];
        let updated = 0;
        for (let i = 0; i < trips.length; i++) {
          const t = trips[i];
          const road = roadByKey.get(segKey(t));
          const data = {
            startedAt: new Date(t.startedAt),
            endedAt: t.isActive ? null : new Date(t.endedAt),
            isActive: t.isActive,
            pointsCount: t.pointsCount,
            distanceM: road ?? t.distanceM,
            roadMatched: road !== undefined,
            startLat: t.startLat,
            startLon: t.startLon,
            endLat: t.endLat,
            endLon: t.endLon,
          };
          const id = ids[i];
          const prev = id ? byId.get(id) : undefined;
          if (!id || !prev) {
            toCreate.push({ childId, ...data });
          } else if (!sameTrip(prev, data)) {
            await tx.trip.update({ where: { id }, data });
            updated++;
          }
        }
        if (toCreate.length > 0) await tx.trip.createMany({ data: toCreate });
        return {
          total: trips.length,
          created: toCreate.length,
          updated,
          deleted: gone.length,
        };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    this.logger.log(
      `trips recomputed child=${childId} saved=${stats.total} created=${stats.created} updated=${stats.updated} deleted=${stats.deleted}`,
    );
  }

  // v0.80.0: пробег поездок по дорогам. Закрытая поездка, уже посчитанная по
  // дорогам, берёт прежний пробег (те же границы и число точек — та же
  // нарезка, см. segKey). Остальные привязываются, не
  // больше ROAD_MATCH_TRIPS_PER_RECOMPUTE за раз, активная — первой.
  // undefined в результате — пробег остаётся по очищенному треку.
  private async roadDistances(
    childId: string,
    trips: Array<{
      startedAt: number;
      endedAt: number;
      isActive: boolean;
      pointsCount: number;
      route: TrackOutPoint[];
    }>,
  ): Promise<Array<number | undefined>> {
    const out = new Array<number | undefined>(trips.length).fill(undefined);
    if (!this.road.enabled() || trips.length === 0) return out;
    const known = new Map<string, number>();
    const rows = await this.prisma.trip.findMany({
      where: { childId, roadMatched: true, isActive: false },
      select: { startedAt: true, endedAt: true, pointsCount: true, distanceM: true },
    });
    for (const r of rows) {
      if (r.endedAt) {
        known.set(
          segKey({
            startedAt: r.startedAt.getTime(),
            endedAt: r.endedAt.getTime(),
            pointsCount: r.pointsCount,
          }),
          r.distanceM,
        );
      }
    }
    const todo: number[] = [];
    trips.forEach((t, i) => {
      const prev = t.isActive ? undefined : known.get(segKey(t));
      if (prev !== undefined) out[i] = prev;
      else todo.push(i);
    });
    // Активная и самые свежие — первыми: их пробег смотрят чаще.
    todo.sort((a, b) => Number(trips[b].isActive) - Number(trips[a].isActive) || b - a);
    for (const i of todo.slice(0, ROAD_MATCH_TRIPS_PER_RECOMPUTE)) {
      const snapped = await this.road.snap(trips[i].route);
      if (!snapped) break; // OSRM недоступен — остальные тоже не выйдет
      if (snapped.complete) out[i] = Math.round(pathLength(snapped.points));
    }
    return out;
  }

  // Очищенный трек за период: без плохих точек, стоянки свёрнуты.
  // v0.80.0: view=road (по умолчанию) — привязан к дорогам, если OSRM доступен.
  private async trackBetween(
    childId: string,
    from: Date,
    to: Date | undefined,
    view: TrackView,
  ): Promise<TrackDto> {
    const p = await this.params();
    const points = await this.goodPoints(childId, from, to, {
      take: TRACK_MAX_POINTS,
      latest: true,
    });
    const built = buildTrack(points, p.idleRadiusM, p.stopMinMs);
    const snapped = view === 'road' ? await this.road.snap(built.points) : null;
    const line: Array<{ lat: number; lon: number; t: number; inferred?: true }> =
      snapped?.points ?? built.points;
    return {
      points: line.map((q) => ({
        lat: q.lat,
        lon: q.lon,
        recordedAt: new Date(q.t).toISOString(),
        ...(q.inferred ? { inferred: true as const } : {}),
      })),
      stays: built.stays.map((s) => ({
        lat: s.lat,
        lon: s.lon,
        from: new Date(s.from).toISOString(),
        to: new Date(s.to).toISOString(),
      })),
    };
  }

  async getTrack(
    childId: string,
    from: Date,
    to: Date,
    view: TrackView = 'road',
  ): Promise<TrackDto> {
    return this.trackBetween(childId, from, to, view);
  }

  async getActiveTrack(
    childId: string,
    view: TrackView = 'road',
  ): Promise<{ trip: TripDto | null } & TrackDto> {
    const empty = { trip: null, points: [], stays: [] };
    const active = await this.prisma.trip.findFirst({
      where: { childId, isActive: true },
      orderBy: { startedAt: 'desc' },
    });
    if (!active) return empty;

    // Ленивая валидация: если с последней точки прошло больше idleMin —
    // считаем trip устаревшим и не отдаём его на фронт (чтобы онлайн-карта
    // очищала линии, не дожидаясь pg_cron). Пересчёт при новых точках
    // разрулит состояние в БД.
    const { idleMs } = await this.params();
    const lastPoint = await this.prisma.location.findFirst({
      where: { childId },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    if (!lastPoint || Date.now() - lastPoint.recordedAt.getTime() >= idleMs) {
      return empty;
    }

    const track = await this.trackBetween(childId, active.startedAt, undefined, view);
    return { trip: this.toDto(active), ...track };
  }

  async listTrips(childId: string, from?: Date, to?: Date): Promise<TripDto[]> {
    const where: { childId: string; startedAt?: { gte?: Date; lte?: Date } } = { childId };
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = from;
      if (to) where.startedAt.lte = to;
    }
    const rows = await this.prisma.trip.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    const dtos = rows.map((r) => this.toDto(r));
    // Аудит 2026-10-12: isActive в БД обновляет только пересчёт после приёма
    // точек. Телефон замолчал — поездка висела бы «идёт» вечно. Как и
    // segmentTrips: с последней хорошей точки прошло idleMs — поездка
    // закончилась на этой точке.
    const active = dtos.filter((t) => t.isActive);
    if (active.length > 0) {
      const { idleMs } = await this.params();
      for (const t of active) {
        const last = await this.prisma.location.findFirst({
          where: { childId, trackFlag: null, recordedAt: { gte: new Date(t.startedAt) } },
          orderBy: { recordedAt: 'desc' },
          select: { recordedAt: true },
        });
        if (last && Date.now() - last.recordedAt.getTime() < idleMs) continue;
        t.isActive = false;
        t.endedAt = (last?.recordedAt ?? new Date(t.startedAt)).toISOString();
      }
    }
    return dtos;
  }

  // Аудит 2026-10-12: несуществующая (или чужая) поездка — 404, а не пустой
  // трек: клиент держит id из списка и должен понять, что его пора обновить.
  async getTripTrack(childId: string, tripId: string, view: TrackView = 'road'): Promise<TrackDto> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.childId !== childId) {
      throw new NotFoundException({ code: 'trip_not_found', message: 'Trip not found' });
    }
    return this.trackBetween(childId, trip.startedAt, trip.endedAt ?? new Date(), view);
  }

  private toDto(r: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    isActive: boolean;
    pointsCount: number;
    distanceM: number;
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
  }): TripDto {
    return {
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      isActive: r.isActive,
      pointsCount: r.pointsCount,
      distanceM: r.distanceM,
      startLat: r.startLat,
      startLon: r.startLon,
      endLat: r.endLat,
      endLon: r.endLon,
    };
  }
}
