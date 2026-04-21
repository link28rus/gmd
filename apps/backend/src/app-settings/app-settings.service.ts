import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Ключи app_settings, которые знает backend. Добавляем сюда — получаем getter.
export const SETTINGS_KEYS = {
  TRIP_IDLE_MINUTES: 'trip.idle_minutes',
  TRIP_IDLE_RADIUS_M: 'trip.idle_radius_m',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class AppSettingsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getString(key: string, fallback: string): Promise<string> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const value = row?.value ?? fallback;
    this.cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.getString(key, String(fallback));
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  async list(): Promise<
    {
      key: string;
      value: string;
      description: string | null;
      updatedAt: string;
      updatedBy: string | null;
    }[]
  > {
    const rows = await this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      description: r.description,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedBy,
    }));
  }

  async update(key: string, value: string, updatedBy: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value, updatedBy },
      // Описание — только при UPDATE существующей записи. Новые ключи создаются
      // только через миграции, где описание фиксируется; update без описания — это
      // попытка создать несуществующий ключ, отдаём ошибку уровнем выше.
      create: { key, value, updatedBy, description: null },
    });
    this.cache.delete(key);
  }

  // Для тестов и ручной инвалидации.
  clearCache(): void {
    this.cache.clear();
  }
}
