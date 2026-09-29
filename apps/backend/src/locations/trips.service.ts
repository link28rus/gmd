import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppSettingsService,
  SETTINGS_KEYS,
  TRACK_DEFAULTS,
} from '../app-settings/app-settings.service';
import { buildTrack, segmentTrips } from './track-builder';
import type { TrackInputPoint, TrackParams } from './track-builder';

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_IDLE_RADIUS_M = 70;
// Трек за произвольный период (карта дня) — не больше стольких точек.
const TRACK_MAX_POINTS = 5000;

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
  private async goodPoints(childId: string, from: Date, to?: Date, take?: number) {
    const rows = await this.prisma.location.findMany({
      where: {
        childId,
        trackFlag: null,
        recordedAt: to ? { gte: from, lte: to } : { gte: from },
      },
      select: { lat: true, lon: true, recordedAt: true, accuracy: true },
      orderBy: { recordedAt: 'asc' },
      take,
    });
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
  //   (б) из pg_cron раз в 5 мин — подстраховка + закрытие активных поездок
  //        у детей, которые перестали присылать точки
  async recomputeForChild(childId: string): Promise<void> {
    const p = await this.params();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const points = await this.goodPoints(childId, since);
    const trips = segmentTrips(points, { ...p, now: Date.now() });

    await this.prisma.$transaction(async (tx) => {
      await tx.trip.deleteMany({ where: { childId } });
      if (trips.length === 0) return;
      await tx.trip.createMany({
        data: trips.map((t) => ({
          childId,
          startedAt: new Date(t.startedAt),
          endedAt: t.isActive ? null : new Date(t.endedAt),
          isActive: t.isActive,
          pointsCount: t.pointsCount,
          distanceM: t.distanceM,
          startLat: t.startLat,
          startLon: t.startLon,
          endLat: t.endLat,
          endLon: t.endLon,
        })),
      });
    });

    this.logger.log(`trips recomputed child=${childId} saved=${trips.length}`);
  }

  // Очищенный трек за период: без плохих точек, стоянки свёрнуты.
  private async trackBetween(childId: string, from: Date, to?: Date): Promise<TrackDto> {
    const p = await this.params();
    const points = await this.goodPoints(childId, from, to, TRACK_MAX_POINTS);
    const built = buildTrack(points, p.idleRadiusM, p.stopMinMs);
    return {
      points: built.points.map((q) => ({
        lat: q.lat,
        lon: q.lon,
        recordedAt: new Date(q.t).toISOString(),
      })),
      stays: built.stays.map((s) => ({
        lat: s.lat,
        lon: s.lon,
        from: new Date(s.from).toISOString(),
        to: new Date(s.to).toISOString(),
      })),
    };
  }

  async getTrack(childId: string, from: Date, to: Date): Promise<TrackDto> {
    return this.trackBetween(childId, from, to);
  }

  async getActiveTrack(childId: string): Promise<{ trip: TripDto | null } & TrackDto> {
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

    const track = await this.trackBetween(childId, active.startedAt);
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
    return rows.map((r) => this.toDto(r));
  }

  async getTripTrack(childId: string, tripId: string): Promise<TrackDto> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.childId !== childId) return { points: [], stays: [] };
    return this.trackBetween(childId, trip.startedAt, trip.endedAt ?? new Date());
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
