import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';
import { distanceMeters } from '../common/geo-distance';

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_IDLE_RADIUS_M = 70;

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

interface Point {
  lat: number;
  lon: number;
  recordedAt: Date;
}

interface TripAcc {
  startedAt: Date;
  endedAt: Date;
  pointsCount: number;
  distanceM: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  // anchor — последняя точка, где движение было значимым (дальше радиуса)
  anchor: Point;
}

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
  ) {}

  // Пересчитывает все поездки ребёнка заново из точек. Грубо, но просто и
  // устойчиво к retroactive-правкам точек. Вызывается:
  //   (а) сразу после каждого ingest — для онлайн-карты
  //   (б) из pg_cron раз в 5 мин — подстраховка + закрытие активных поездок
  //        у детей, которые перестали присылать точки
  async recomputeForChild(childId: string): Promise<void> {
    const [idleMinutes, idleRadiusM] = await Promise.all([
      this.settings.getNumber(SETTINGS_KEYS.TRIP_IDLE_MINUTES, DEFAULT_IDLE_MINUTES),
      this.settings.getNumber(SETTINGS_KEYS.TRIP_IDLE_RADIUS_M, DEFAULT_IDLE_RADIUS_M),
    ]);
    const idleMs = idleMinutes * 60 * 1000;

    // Берём все точки за retention-период (30 дней). Можно оптимизировать —
    // пересчитывать только с последнего закрытого trip'а, но для MVP проще.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.location.findMany({
      where: { childId, recordedAt: { gte: since } },
      select: { lat: true, lon: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });

    const now = Date.now();
    const trips: TripAcc[] = [];
    let current: TripAcc | null = null;

    for (const p of rows) {
      const point: Point = { lat: p.lat, lon: p.lon, recordedAt: p.recordedAt };

      if (!current) {
        current = this.startNewTrip(point);
        continue;
      }

      const distFromAnchor = distanceMeters(
        current.anchor.lat,
        current.anchor.lon,
        point.lat,
        point.lon,
      );

      if (distFromAnchor > idleRadiusM) {
        // Движение — обновляем anchor, добавляем в trip.
        current.distanceM += Math.round(distFromAnchor);
        current.pointsCount += 1;
        current.endedAt = point.recordedAt;
        current.endLat = point.lat;
        current.endLon = point.lon;
        current.anchor = point;
      } else {
        // В радиусе anchor — добавляем в trip (считаем как "стояние рядом").
        const idleSoFar = point.recordedAt.getTime() - current.anchor.recordedAt.getTime();
        if (idleSoFar >= idleMs) {
          // Ребёнок стоит слишком долго — закрываем trip на anchor, дальше новый trip
          // начнётся когда снова будет движение.
          trips.push(current);
          current = null;
          // Эту точку НЕ начинаем как новый trip (она часть "стоянки").
          // Новый trip стартует с точки, где будет движение дальше radius от этой.
        } else {
          current.pointsCount += 1;
          current.endedAt = point.recordedAt;
          current.endLat = point.lat;
          current.endLon = point.lon;
        }
      }
    }

    // Закрываем висящий активный trip, если он "застрял" (последняя точка давно):
    // но помечаем isActive по факту — если > idleMs прошло с endedAt, trip не активный.
    if (current) trips.push(current);

    // Пересчёт в БД: атомарно удалим все trips ребёнка и вставим заново.
    // Оптимизация — diff'инг — позже; для MVP проще и надёжнее.
    await this.prisma.$transaction(async (tx) => {
      await tx.trip.deleteMany({ where: { childId } });
      for (let i = 0; i < trips.length; i++) {
        const t = trips[i];
        const isLast = i === trips.length - 1;
        const idleSinceEnd = now - t.endedAt.getTime();
        const isActive = isLast && idleSinceEnd < idleMs;
        await tx.trip.create({
          data: {
            childId,
            startedAt: t.startedAt,
            endedAt: isActive ? null : t.endedAt,
            isActive,
            pointsCount: t.pointsCount,
            distanceM: t.distanceM,
            startLat: t.startLat,
            startLon: t.startLon,
            endLat: t.endLat,
            endLon: t.endLon,
          },
        });
      }
    });

    this.logger.log(`trips recomputed child=${childId} total=${trips.length}`);
  }

  async getActiveTrack(childId: string): Promise<{ trip: TripDto | null; points: Point[] }> {
    const active = await this.prisma.trip.findFirst({
      where: { childId, isActive: true },
      orderBy: { startedAt: 'desc' },
    });
    if (!active) return { trip: null, points: [] };

    // Ленивая валидация: если с последней точки в trip прошло больше idleMin —
    // считаем trip устаревшим и не отдаём его на фронт (чтобы онлайн-карта
    // очищала линии, не дожидаясь pg_cron). Формально trip остаётся isActive
    // в БД до следующего ingest'а — это не страшно, пересчёт при новых точках
    // разрулит состояние.
    const idleMinutes = await this.settings.getNumber(
      SETTINGS_KEYS.TRIP_IDLE_MINUTES,
      DEFAULT_IDLE_MINUTES,
    );
    const idleMs = idleMinutes * 60 * 1000;
    const lastPoint = await this.prisma.location.findFirst({
      where: { childId },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    if (!lastPoint || Date.now() - lastPoint.recordedAt.getTime() >= idleMs) {
      return { trip: null, points: [] };
    }

    const points = await this.prisma.location.findMany({
      where: { childId, recordedAt: { gte: active.startedAt } },
      select: { lat: true, lon: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });
    return { trip: this.toDto(active), points };
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

  async getTripPoints(childId: string, tripId: string): Promise<Point[]> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.childId !== childId) return [];
    const points = await this.prisma.location.findMany({
      where: {
        childId,
        recordedAt: {
          gte: trip.startedAt,
          lte: trip.endedAt ?? new Date(),
        },
      },
      select: { lat: true, lon: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });
    return points;
  }

  private startNewTrip(p: Point): TripAcc {
    return {
      startedAt: p.recordedAt,
      endedAt: p.recordedAt,
      pointsCount: 1,
      distanceM: 0,
      startLat: p.lat,
      startLon: p.lon,
      endLat: p.lat,
      endLon: p.lon,
      anchor: p,
    };
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
