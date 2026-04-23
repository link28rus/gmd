/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { AppSettingsService, SETTINGS_KEYS } from './app-settings.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Минимальный mock SecretsService */
function makeSecrets(): any {
  return {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  };
}

/**
 * Фабрика mock-Prisma. Хранит записи in-memory, имитируя реальную БД:
 * create / findUnique / findMany / count / deleteMany / $transaction / upsert.
 */
function makePrisma(): any {
  const store = new Map<string, any>();

  const appSetting = {
    create: jest.fn(async ({ data }: any) => {
      const row = { ...data, updatedAt: new Date() };
      store.set(data.key, row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => store.get(where.key) ?? null),
    findMany: jest.fn(async ({ where, orderBy }: any) => {
      let rows = [...store.values()];
      if (where?.key?.startsWith) {
        rows = rows.filter((r) => r.key.startsWith(where.key.startsWith));
      }
      if (orderBy?.key === 'asc') rows.sort((a, b) => a.key.localeCompare(b.key));
      return rows;
    }),
    count: jest.fn(async ({ where }: any) => {
      if (where?.key?.startsWith) {
        return [...store.values()].filter((r) => r.key.startsWith(where.key.startsWith)).length;
      }
      return store.size;
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      if (where?.key?.startsWith) {
        for (const k of [...store.keys()]) {
          if (k.startsWith(where.key.startsWith)) store.delete(k);
        }
      }
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const existing = store.get(where.key);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        store.set(where.key, updated);
        return updated;
      }
      const row = { ...create, updatedAt: new Date() };
      store.set(where.key, row);
      return row;
    }),
  };

  return {
    appSetting,
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    _store: store, // для прямого доступа в тестах
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppSettingsService — seedAudioIfEmpty', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AppSettingsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AppSettingsService(prisma, makeSecrets());
  });

  it('seeds 5 audio.* keys when none exist', async () => {
    await service.onModuleInit();

    const rows = await prisma.appSetting.findMany({
      where: { key: { startsWith: 'audio.' } },
      orderBy: { key: 'asc' },
    });

    expect(rows).toHaveLength(5);

    const byKey = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
    expect(byKey['audio.default_duration_sec']).toBe('300');
    expect(byKey['audio.max_duration_sec']).toBe('1800');
    expect(byKey['audio.min_duration_sec']).toBe('30');
    expect(byKey['audio.hidden_mode_allowed']).toBe('true');
    expect(byKey['audio.child_ready_timeout_sec']).toBe('15');
  });

  it('all seeded audio.* rows have isSecret=false and updatedBy=system:seed', async () => {
    await service.onModuleInit();

    const rows = await prisma.appSetting.findMany({
      where: { key: { startsWith: 'audio.' } },
    });

    for (const r of rows) {
      expect(r.isSecret).toBe(false);
      expect(r.updatedBy).toBe('system:seed');
    }
  });

  it('idempotent: does not overwrite existing audio.* on second onModuleInit', async () => {
    // Первый запуск — заполняет дефолты
    await service.onModuleInit();

    // Меняем значение
    await service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, '600', 'test');
    service.clearCache();

    // Второй запуск
    await service.onModuleInit();

    const row = await prisma.appSetting.findUnique({
      where: { key: SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC },
    });
    expect(row?.value).toBe('600');
  });

  it('does not touch smtp.* or location.* when seeding audio.*', async () => {
    // Добавляем чужие ключи заранее
    prisma._store.set('smtp.host', { key: 'smtp.host', value: 'mail.example.com' });
    prisma._store.set('location.accuracy_floor_m', {
      key: 'location.accuracy_floor_m',
      value: '100',
    });

    await service.onModuleInit();

    // Чужие ключи не изменились
    expect(prisma._store.get('smtp.host')?.value).toBe('mail.example.com');
    expect(prisma._store.get('location.accuracy_floor_m')?.value).toBe('100');
  });
});

describe('AppSettingsService — KEY_BOUNDS for audio.*', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AppSettingsService;

  beforeEach(async () => {
    prisma = makePrisma();
    service = new AppSettingsService(prisma, makeSecrets());
    // Seed чтобы ключи существовали (upsert создаст при необходимости)
    await service.onModuleInit();
    service.clearCache();
  });

  it('rejects value above max for default_duration_sec', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, '9999', 'test'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects value below min for default_duration_sec', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, '5', 'test'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects negative value for min_duration_sec', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, '-1', 'test'),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts in-range value for default_duration_sec', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, '600', 'test'),
    ).resolves.not.toThrow();
  });

  it('accepts boundary min value for default_duration_sec (30)', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, '30', 'test'),
    ).resolves.not.toThrow();
  });

  it('accepts boundary max value for default_duration_sec (1800)', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, '1800', 'test'),
    ).resolves.not.toThrow();
  });

  it('rejects value above max for max_duration_sec (3600)', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, '3601', 'test'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects value above max for child_ready_timeout_sec (120)', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC, '999', 'test'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-numeric value for default_duration_sec', async () => {
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, 'abc', 'test'),
    ).rejects.toThrow(BadRequestException);
  });

  it('AUDIO_HIDDEN_MODE_ALLOWED has no bounds check (boolean key)', async () => {
    // boolean ключ — обновляется без ограничений range
    await expect(
      service.update(SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED, 'false', 'test'),
    ).resolves.not.toThrow();
  });
});
