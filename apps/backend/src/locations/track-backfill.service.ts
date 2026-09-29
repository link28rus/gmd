import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppSettingsService,
  SETTINGS_KEYS,
  TRACK_DEFAULTS,
} from '../app-settings/app-settings.service';
import { TripsService } from './trips.service';
import { classifyTrack } from './track-quality';
import type { TrackFlag } from './track-quality';

// Версия правил разметки. Поднять — и при следующем старте backend один раз
// переразметит точки за 30 дней и пересчитает поездки.
export const TRACK_RULES_VERSION = '1';
const MARKER_KEY = 'system.track_rules_version';
const UPDATE_CHUNK = 1000;

/**
 * v0.63.0 — переразметка истории точек (trackFlag) по текущим правилам.
 * Работает в фоне после старта, не задерживая приём запросов. Идемпотентна:
 * версия правил пишется в app_settings, повторно не запускается.
 */
@Injectable()
export class TrackBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrackBackfillService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(TripsService) private readonly trips: TripsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.runIfNeeded().catch((e: unknown) =>
      this.logger.error(`track backfill failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  async runIfNeeded(): Promise<void> {
    const marker = await this.prisma.appSetting.findUnique({ where: { key: MARKER_KEY } });
    if (marker?.value === TRACK_RULES_VERSION) return;

    const [accuracyMaxM, maxSpeedMps] = await Promise.all([
      this.settings.getNumber(SETTINGS_KEYS.TRACK_ACCURACY_MAX_M, TRACK_DEFAULTS.accuracyMaxM),
      this.settings.getNumber(SETTINGS_KEYS.TRACK_MAX_SPEED_MPS, TRACK_DEFAULTS.maxSpeedMps),
    ]);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const devices = await this.prisma.location.groupBy({
      by: ['childDeviceId', 'childId'],
      where: { recordedAt: { gte: since } },
    });

    const stats: Record<string, number> = {};
    const children = new Set<string>();
    for (const d of devices) {
      const rows = await this.prisma.location.findMany({
        where: { childDeviceId: d.childDeviceId, recordedAt: { gte: since } },
        select: {
          id: true,
          lat: true,
          lon: true,
          accuracy: true,
          speed: true,
          recordedAt: true,
          trackFlag: true,
        },
        orderBy: { recordedAt: 'asc' },
      });
      const flags = classifyTrack(
        rows.map((r) => ({
          lat: r.lat,
          lon: r.lon,
          accuracy: r.accuracy,
          speed: r.speed,
          t: r.recordedAt.getTime(),
          flag: r.trackFlag === 'mock' ? 'mock' : null,
        })),
        { accuracyMaxM, maxSpeedMps },
      );
      const byFlag = new Map<TrackFlag | null, string[]>();
      rows.forEach((r, i) => {
        stats[flags[i] ?? 'ok'] = (stats[flags[i] ?? 'ok'] ?? 0) + 1;
        if (flags[i] === r.trackFlag) return;
        byFlag.set(flags[i], [...(byFlag.get(flags[i]) ?? []), r.id]);
      });
      for (const [flag, ids] of byFlag) {
        for (let k = 0; k < ids.length; k += UPDATE_CHUNK) {
          await this.prisma.location.updateMany({
            where: { id: { in: ids.slice(k, k + UPDATE_CHUNK) } },
            data: { trackFlag: flag },
          });
        }
      }
      children.add(d.childId);
    }

    for (const childId of children) await this.trips.recomputeForChild(childId);

    await this.prisma.appSetting.upsert({
      where: { key: MARKER_KEY },
      create: {
        key: MARKER_KEY,
        value: TRACK_RULES_VERSION,
        description:
          'Служебное: версия правил разметки точек маршрута, по которой переразмечена ' +
          'история. Не менять вручную.',
        updatedBy: 'system:track-backfill',
      },
      update: { value: TRACK_RULES_VERSION, updatedBy: 'system:track-backfill' },
    });
    this.logger.log(
      `track backfill v${TRACK_RULES_VERSION}: devices=${devices.length} ${JSON.stringify(stats)}`,
    );
  }
}
