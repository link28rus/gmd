import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryResolver, type AppCategory } from './category-resolver.service';
import type { InstalledAppsBody } from './dto/installed-apps.dto';
import type { UsageReportBody } from './dto/usage-report.dto';
import type { AppIconsBody } from './dto/app-icons.dto';

const MAX_ICON_BYTES = 100 * 1024; // 100KB raw PNG

interface ParentInstalledApp {
  packageName: string;
  appLabel: string;
  iconUrl: string | null;
  category: AppCategory;
  isSystem: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  todaySeconds: number;
}

interface UsageRange {
  totalSeconds: number;
  byHour: number[]; // length=24 для day, length=7 для week
  byPackage: Array<{
    packageName: string;
    appLabel: string | null;
    seconds: number;
    category: AppCategory;
  }>;
  byCategory: Record<AppCategory, number>;
  vsAverage: number | null; // % разница от среднего за 7 пред. дней (для day) | null если мало данных
}

@Injectable()
export class AppControlService {
  private readonly logger = new Logger(AppControlService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CategoryResolver) private readonly categories: CategoryResolver,
  ) {}

  // ─── Child-side ─────────────────────────────────────────────────────────

  /**
   * UPSERT снапшота установленных apps + обновление timezone у device.
   * Возвращает список sha256, для которых backend ещё НЕ имеет иконки —
   * child должен залить их через POST /child/app-icons.
   */
  async upsertInstalledApps(
    childDeviceId: string,
    body: InstalledAppsBody,
  ): Promise<{ missingIconSha256: string[] }> {
    // Update timezone (всегда, даже если payload пустой)
    await this.prisma.childDevice.update({
      where: { id: childDeviceId },
      data: { timezone: body.timezone, lastSeenAt: new Date() },
    });

    // UPSERT каждого app. Делаем последовательно для простоты — payload max 1000,
    // upsert ~5ms, итого <5sec в худшем случае. Параллелизация через Promise.all
    // создаст шторм коннектов, не нужно.
    const now = new Date();
    for (const app of body.apps) {
      const category = this.categories.resolve(app.packageName);
      await this.prisma.installedApp.upsert({
        where: {
          childDeviceId_packageName: {
            childDeviceId,
            packageName: app.packageName,
          },
        },
        create: {
          childDeviceId,
          packageName: app.packageName,
          appLabel: app.appLabel,
          iconSha256: app.iconSha256 ?? null,
          isSystem: app.isSystem,
          category,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          appLabel: app.appLabel,
          iconSha256: app.iconSha256 ?? null,
          isSystem: app.isSystem,
          category,
          lastSeenAt: now,
        },
      });
    }

    // Какие sha256 backend ещё не имеет?
    const referencedShas = body.apps
      .map((a) => a.iconSha256)
      .filter((s): s is string => typeof s === 'string');
    if (referencedShas.length === 0) return { missingIconSha256: [] };

    const existing = await this.prisma.appIcon.findMany({
      where: { sha256: { in: referencedShas } },
      select: { sha256: true },
    });
    const existingSet = new Set(existing.map((e) => e.sha256));
    const missing = referencedShas.filter((s) => !existingSet.has(s));
    return { missingIconSha256: missing };
  }

  /** Загрузка иконок батчем. Проверяет sha256 на соответствие байтам. */
  async uploadAppIcons(body: AppIconsBody): Promise<{ uploaded: number; skipped: number }> {
    let uploaded = 0;
    let skipped = 0;
    for (const item of body.icons) {
      const raw = Buffer.from(item.pngBase64, 'base64');
      if (raw.length > MAX_ICON_BYTES) {
        throw new BadRequestException({
          code: 'icon_too_large',
          message: `icon ${item.sha256} is ${raw.length} bytes, max ${MAX_ICON_BYTES}`,
        });
      }
      const actualSha = createHash('sha256').update(raw).digest('hex');
      if (actualSha !== item.sha256) {
        throw new BadRequestException({
          code: 'icon_sha256_mismatch',
          message: `claimed sha256 ${item.sha256} but actual is ${actualSha}`,
        });
      }
      // Простая защита: PNG magic — 89 50 4E 47 0D 0A 1A 0A
      if (
        raw.length < 8 ||
        raw[0] !== 0x89 ||
        raw[1] !== 0x50 ||
        raw[2] !== 0x4e ||
        raw[3] !== 0x47
      ) {
        throw new BadRequestException({
          code: 'icon_not_png',
          message: `icon ${item.sha256} is not a valid PNG`,
        });
      }

      // Skip if уже есть (race protection — sha256 immutable, content тот же)
      const existing = await this.prisma.appIcon.findUnique({
        where: { sha256: item.sha256 },
        select: { sha256: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await this.prisma.appIcon.create({
        data: { sha256: item.sha256, pngBytes: raw, bytes: raw.length },
      });
      uploaded++;
    }
    this.logger.log(`uploaded ${uploaded} icons, skipped ${skipped} (already cached)`);
    return { uploaded, skipped };
  }

  /** Достать байты иконки по sha256 (для GET /app-icons/:sha256). */
  async getIconBytes(sha256: string): Promise<Buffer | null> {
    const row = await this.prisma.appIcon.findUnique({
      where: { sha256 },
      select: { pngBytes: true },
    });
    return row ? Buffer.from(row.pngBytes) : null;
  }

  /** UPSERT часовых bucket'ов использования. */
  async upsertUsageBuckets(
    childDeviceId: string,
    body: UsageReportBody,
  ): Promise<{ accepted: number }> {
    // Update timezone (если изменилась)
    await this.prisma.childDevice.update({
      where: { id: childDeviceId },
      data: { timezone: body.timezone, lastSeenAt: new Date() },
    });

    // Лимит: не принимаем bucket'ы с date в будущем (clock skew защита)
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    let accepted = 0;
    for (const b of body.buckets) {
      const date = new Date(b.date + 'T00:00:00.000Z');
      if (date.getTime() > today.getTime() + 24 * 3600_000) {
        continue; // skip — в будущем больше чем на день, явная ошибка
      }
      await this.prisma.usageBucket.upsert({
        where: {
          childDeviceId_date_hour_packageName: {
            childDeviceId,
            date,
            hour: b.hour,
            packageName: b.packageName,
          },
        },
        create: {
          childDeviceId,
          date,
          hour: b.hour,
          packageName: b.packageName,
          seconds: b.seconds,
        },
        update: { seconds: b.seconds }, // replace, не add — см. семантику в DTO
      });
      accepted++;
    }
    return { accepted };
  }

  // ─── Parent-side ────────────────────────────────────────────────────────

  /**
   * Список установленных apps у ребёнка (для UI парента).
   * Включает иконку (URL `/app-icons/:sha256`), категорию и время использования
   * за СЕГОДНЯ (в TZ ребёнка).
   */
  async listInstalledApps(childId: string, baseUrl: string): Promise<ParentInstalledApp[]> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: { id: true, timezone: true },
    });
    if (!device) return [];

    const apps = await this.prisma.installedApp.findMany({
      where: { childDeviceId: device.id },
      orderBy: [{ lastSeenAt: 'desc' }, { appLabel: 'asc' }],
    });

    // Сегодняшние usage — одним запросом
    const today = this.localToday(device.timezone);
    const usage = await this.prisma.usageBucket.groupBy({
      by: ['packageName'],
      where: { childDeviceId: device.id, date: today },
      _sum: { seconds: true },
    });
    const todayMap = new Map<string, number>();
    for (const u of usage) {
      todayMap.set(u.packageName, u._sum.seconds ?? 0);
    }

    return apps.map((a) => ({
      packageName: a.packageName,
      appLabel: a.appLabel,
      iconUrl: a.iconSha256 ? `${baseUrl}/app-icons/${a.iconSha256}` : null,
      category: (a.category as AppCategory | null) ?? 'other',
      isSystem: a.isSystem,
      firstSeenAt: a.firstSeenAt,
      lastSeenAt: a.lastSeenAt,
      todaySeconds: todayMap.get(a.packageName) ?? 0,
    }));
  }

  /**
   * Агрегированная статистика usage за указанный диапазон.
   * range='day' → date= один день в TZ ребёнка, byHour[24]
   * range='week' → date= конец недели (последний день), byHour[7] = по дням
   */
  async getUsage(
    childId: string,
    range: 'day' | 'week',
    dateStr: string | null,
  ): Promise<UsageRange | null> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: { id: true, timezone: true },
    });
    if (!device) {
      throw new NotFoundException({ code: 'child_device_not_found', message: 'No active device' });
    }

    const targetDate = dateStr
      ? this.parseDateOrToday(dateStr, device.timezone)
      : this.localToday(device.timezone);

    if (range === 'day') {
      return this.aggregateDay(device.id, targetDate);
    }
    return this.aggregateWeek(device.id, targetDate);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async aggregateDay(childDeviceId: string, date: Date): Promise<UsageRange> {
    const buckets = await this.prisma.usageBucket.findMany({
      where: { childDeviceId, date },
      select: { hour: true, packageName: true, seconds: true },
    });
    const byHour = new Array(24).fill(0) as number[];
    const byPkg = new Map<string, number>();
    let total = 0;
    for (const b of buckets) {
      byHour[b.hour] += b.seconds;
      byPkg.set(b.packageName, (byPkg.get(b.packageName) ?? 0) + b.seconds);
      total += b.seconds;
    }
    const labels = await this.fetchLabels(childDeviceId, [...byPkg.keys()]);
    const byPackage = [...byPkg.entries()]
      .map(([packageName, seconds]) => ({
        packageName,
        appLabel: labels.get(packageName) ?? null,
        seconds,
        category: this.categories.resolve(packageName),
      }))
      .sort((a, b) => b.seconds - a.seconds);
    const byCategory = this.aggregateByCategory(byPackage);
    const vsAverage = await this.calcVsAverage(childDeviceId, date, total);
    return { totalSeconds: total, byHour, byPackage, byCategory, vsAverage };
  }

  private async aggregateWeek(childDeviceId: string, endDate: Date): Promise<UsageRange> {
    const start = new Date(endDate);
    start.setUTCDate(start.getUTCDate() - 6); // 7 дней включая endDate
    const buckets = await this.prisma.usageBucket.findMany({
      where: { childDeviceId, date: { gte: start, lte: endDate } },
      select: { date: true, packageName: true, seconds: true },
    });
    const byHour = new Array(7).fill(0) as number[]; // index 0 = start, 6 = endDate
    const byPkg = new Map<string, number>();
    let total = 0;
    const startMs = start.getTime();
    for (const b of buckets) {
      const dayIdx = Math.floor((b.date.getTime() - startMs) / 86400_000);
      if (dayIdx >= 0 && dayIdx < 7) {
        byHour[dayIdx] += b.seconds;
      }
      byPkg.set(b.packageName, (byPkg.get(b.packageName) ?? 0) + b.seconds);
      total += b.seconds;
    }
    const labels = await this.fetchLabels(childDeviceId, [...byPkg.keys()]);
    const byPackage = [...byPkg.entries()]
      .map(([packageName, seconds]) => ({
        packageName,
        appLabel: labels.get(packageName) ?? null,
        seconds,
        category: this.categories.resolve(packageName),
      }))
      .sort((a, b) => b.seconds - a.seconds);
    const byCategory = this.aggregateByCategory(byPackage);
    return { totalSeconds: total, byHour, byPackage, byCategory, vsAverage: null };
  }

  private async fetchLabels(
    childDeviceId: string,
    packages: string[],
  ): Promise<Map<string, string>> {
    if (packages.length === 0) return new Map();
    const apps = await this.prisma.installedApp.findMany({
      where: { childDeviceId, packageName: { in: packages } },
      select: { packageName: true, appLabel: true },
    });
    return new Map(apps.map((a) => [a.packageName, a.appLabel]));
  }

  private aggregateByCategory(
    byPackage: Array<{ seconds: number; category: AppCategory }>,
  ): Record<AppCategory, number> {
    const out: Record<string, number> = {
      social: 0,
      messengers: 0,
      video: 0,
      games: 0,
      browsers: 0,
      education: 0,
      music: 0,
      navigation: 0,
      shopping: 0,
      system: 0,
      other: 0,
    };
    for (const p of byPackage) {
      out[p.category] += p.seconds;
    }
    return out as Record<AppCategory, number>;
  }

  private async calcVsAverage(
    childDeviceId: string,
    today: Date,
    todaySeconds: number,
  ): Promise<number | null> {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 7);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() - 1); // вчера и раньше
    const prev = await this.prisma.usageBucket.groupBy({
      by: ['date'],
      where: { childDeviceId, date: { gte: start, lte: end } },
      _sum: { seconds: true },
    });
    if (prev.length < 3) return null; // мало данных
    const dailyTotals = prev.map((p) => p._sum.seconds ?? 0);
    const avg = dailyTotals.reduce((s, v) => s + v, 0) / dailyTotals.length;
    if (avg === 0) return null;
    return Math.round(((todaySeconds - avg) / avg) * 100);
  }

  /**
   * "Сегодня" в TZ ребёнка (или UTC если timezone не задан).
   * Возвращает Date с временем 00:00:00 UTC, представляющую local-date — мы храним
   * UsageBucket.date как DATE (без TZ), значение = local-date в TZ ребёнка.
   */
  private localToday(tz: string | null): Date {
    if (!tz) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    // Получаем YYYY-MM-DD в указанной TZ через Intl.DateTimeFormat
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  }

  private parseDateOrToday(dateStr: string, _tz: string | null): Date {
    // tz не используется — даты в DTO уже local-date в TZ ребёнка (см. семантику
    // в usage-report.dto.ts). Параметр оставлен на будущее, если понадобится
    // авто-выбор сегодняшней даты по TZ.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException({
        code: 'invalid_date',
        message: 'date must be YYYY-MM-DD',
      });
    }
    return new Date(`${dateStr}T00:00:00.000Z`);
  }
}
