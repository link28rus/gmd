import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { distanceMeters } from '../common/geo-distance';
import type { TrackInputPoint } from '../locations/track-builder';
import { childPlaces, visitStats, zoneVisits } from './place-insights';
import type { ChildPlace, PlaceKind } from './place-insights';
import { isValidTimeZone } from './zone-time';
import type { DismissPlaceDto, PlaceSuggestionDto, ZoneStatsDto } from './dto/zone-places.schema';

// v0.67.0 (геозоны v2, этап 4): подсказки мест по частым стоянкам и
// статистика визитов в зону. Считается на лету по хорошим точкам за 30 дней
// (столько же живут локации) — отдельного хранилища нет.

export const PLACES_PERIOD_DAYS = 30;
const DEFAULT_TZ = 'Europe/Moscow';
// Места двух детей одного вида ближе этого — одна подсказка на обоих.
const MERGE_RADIUS_M = 200;
// «Больше не показывать» гасит подсказки ближе этого от скрытой точки.
const DISMISS_RADIUS_M = 200;
// Место уже покрыто зоной, если центр места не дальше радиуса зоны + запас.
const COVERED_MARGIN_M = 50;
// Незакрытый визит считаем текущим, пока последняя точка внутри не старше.
const ONGOING_FRESH_MS = 2 * 3_600_000;

const PRESET: Record<PlaceKind, { name: string; icon: string; color: string }> = {
  home: { name: 'Дом', icon: 'home', color: '#22c55e' },
  school: { name: 'Школа', icon: 'school', color: '#3b82f6' },
  frequent: { name: '', icon: 'other', color: '#a855f7' },
};
const KIND_ORDER: PlaceKind[] = ['home', 'school', 'frequent'];

interface Merged {
  kind: PlaceKind;
  lat: number;
  lon: number;
  radius: number;
  items: Array<{ childId: string; place: ChildPlace }>;
  /** Дети, у которых это же место распознано иначе (см. ниже) — без доказательств. */
  extraChildIds: string[];
}

@Injectable()
export class ZonePlacesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private tz(tz: string | undefined): string {
    if (!tz) return DEFAULT_TZ;
    if (!isValidTimeZone(tz)) {
      throw new BadRequestException({
        code: 'invalid_timezone',
        message: 'Unknown IANA time zone',
      });
    }
    return tz;
  }

  private async goodPoints(childId: string, now: Date): Promise<TrackInputPoint[]> {
    const rows = await this.prisma.location.findMany({
      where: {
        childId,
        trackFlag: null,
        recordedAt: { gte: new Date(now.getTime() - PLACES_PERIOD_DAYS * 86_400_000) },
      },
      select: { lat: true, lon: true, recordedAt: true, accuracy: true },
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((r) => ({
      lat: r.lat,
      lon: r.lon,
      t: r.recordedAt.getTime(),
      accuracy: r.accuracy,
    }));
  }

  async suggestions(
    familyId: string,
    tzParam: string | undefined,
    now = new Date(),
  ): Promise<PlaceSuggestionDto[]> {
    const tz = this.tz(tzParam);
    const [children, zones, dismissed] = await Promise.all([
      this.prisma.child.findMany({
        where: { familyId, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.zone.findMany({
        where: { familyId, deletedAt: null },
        select: { centerLat: true, centerLon: true, radius: true },
      }),
      this.prisma.zonePlaceDismissal.findMany({
        where: { familyId },
        select: { lat: true, lon: true },
      }),
    ]);

    // Точки детей читаем по очереди — не держим в памяти всех сразу.
    const merged: Merged[] = [];
    for (const child of children) {
      const places = childPlaces(await this.goodPoints(child.id, now), tz);
      for (const place of places) {
        const same = merged.find(
          (m) =>
            m.kind === place.kind &&
            distanceMeters(m.lat, m.lon, place.lat, place.lon) <= MERGE_RADIUS_M,
        );
        if (same) {
          same.items.push({ childId: child.id, place });
          same.radius = Math.max(same.radius, place.radius);
        } else {
          merged.push({
            kind: place.kind,
            lat: place.lat,
            lon: place.lon,
            radius: place.radius,
            items: [{ childId: child.id, place }],
            extraChildIds: [],
          });
        }
      }
    }

    // У ребёнка с редкими ночными точками дом может распознаться «частым
    // местом» (на проде: 4 дня данных). Отдельная подсказка на то же место
    // рядом с «Дом?» — дубль: такой ребёнок просто добавляется в зону дома
    // или школы, его доказательство (другого вида) не показываем.
    for (const f of merged.filter((m) => m.kind === 'frequent')) {
      const host = merged.find(
        (m) =>
          m.kind !== 'frequent' && distanceMeters(m.lat, m.lon, f.lat, f.lon) <= MERGE_RADIUS_M,
      );
      if (!host) continue;
      host.extraChildIds.push(...f.items.map((i) => i.childId));
      merged.splice(merged.indexOf(f), 1);
    }

    const near = (m: Merged, lat: number, lon: number, r: number) =>
      distanceMeters(m.lat, m.lon, lat, lon) <= r;

    return merged
      .filter(
        (m) =>
          !zones.some((z) => near(m, z.centerLat, z.centerLon, z.radius + COVERED_MARGIN_M)) &&
          !dismissed.some((d) => near(m, d.lat, d.lon, DISMISS_RADIUS_M)),
      )
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
      .map((m) => {
        // Центр подсказки — среднее мест детей.
        const lat = m.items.reduce((s, i) => s + i.place.lat, 0) / m.items.length;
        const lon = m.items.reduce((s, i) => s + i.place.lon, 0) / m.items.length;
        return {
          id: `${m.kind}:${lat.toFixed(4)}:${lon.toFixed(4)}`,
          kind: m.kind,
          ...PRESET[m.kind],
          centerLat: lat,
          centerLon: lon,
          radius: m.radius,
          childIds: [...new Set([...m.items.map((i) => i.childId), ...m.extraChildIds])],
          children: m.items.map(({ childId, place }) => ({
            childId,
            days: place.days,
            daysWithData: place.daysWithData,
            typicalFromMin: place.typicalFromMin,
            typicalToMin: place.typicalToMin,
          })),
        };
      });
  }

  async dismiss(familyId: string, userId: string, dto: DismissPlaceDto): Promise<void> {
    // Повторное скрытие того же места (второй родитель, двойной клик) — без
    // новой строки: скрытые точки читаются целиком на каждый запрос подсказок.
    const existing = await this.prisma.zonePlaceDismissal.findMany({
      where: { familyId },
      select: { lat: true, lon: true },
    });
    if (
      existing.some(
        (d) => distanceMeters(d.lat, d.lon, dto.centerLat, dto.centerLon) <= DISMISS_RADIUS_M,
      )
    ) {
      return;
    }
    await this.prisma.zonePlaceDismissal.create({
      data: {
        familyId,
        kind: dto.kind,
        lat: dto.centerLat,
        lon: dto.centerLon,
        createdBy: userId,
      },
    });
  }

  async zoneStats(
    familyId: string,
    zoneId: string,
    tzParam: string | undefined,
    now = new Date(),
  ): Promise<ZoneStatsDto> {
    const zone = await this.prisma.zone.findFirst({
      where: { id: zoneId, familyId, deletedAt: null },
      select: {
        centerLat: true,
        centerLon: true,
        radius: true,
        allChildren: true,
        timezone: true,
        assignments: { select: { childId: true } },
      },
    });
    if (!zone) {
      throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
    }
    // Пояс зоны главнее пояса клиента: в нём же считаются расписание и срок.
    const tz = zone.timezone ?? this.tz(tzParam);
    const childIds = zone.allChildren
      ? (
          await this.prisma.child.findMany({
            where: { familyId, deletedAt: null },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          })
        ).map((c) => c.id)
      : zone.assignments.map((a) => a.childId);

    const children: ZoneStatsDto['children'] = [];
    for (const childId of childIds) {
      const visits = zoneVisits(await this.goodPoints(childId, now), {
        lat: zone.centerLat,
        lon: zone.centerLon,
        radius: zone.radius,
      });
      const s = visitStats(visits, tz);
      children.push({
        childId,
        visits: s.visits,
        totalSec: s.totalSec,
        avgSec: s.avgSec,
        daysCount: s.daysCount,
        lastVisitFrom: s.lastVisitFrom !== null ? new Date(s.lastVisitFrom).toISOString() : null,
        lastVisitTo: s.lastVisitTo !== null ? new Date(s.lastVisitTo).toISOString() : null,
        // «Сейчас в зоне» — только если последняя точка внутри свежая.
        ongoing:
          s.ongoing && s.lastVisitTo !== null && now.getTime() - s.lastVisitTo < ONGOING_FRESH_MS,
        typicalArrivalMin: s.typicalArrivalMin,
        typicalDepartureMin: s.typicalDepartureMin,
      });
    }
    return { zoneId, periodDays: PLACES_PERIOD_DAYS, timezone: tz, children };
  }
}
