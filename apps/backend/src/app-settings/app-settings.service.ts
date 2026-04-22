import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../common/secrets/secrets.service';

// Ключи app_settings, которые знает backend. Добавляем сюда — получаем getter.
export const SETTINGS_KEYS = {
  TRIP_IDLE_MINUTES: 'trip.idle_minutes',
  TRIP_IDLE_RADIUS_M: 'trip.idle_radius_m',
  SMTP_HOST: 'smtp.host',
  SMTP_PORT: 'smtp.port',
  SMTP_USER: 'smtp.user',
  SMTP_PASS: 'smtp.pass',
  SMTP_FROM: 'smtp.from',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

// Ключи, которые при обновлении должны шифроваться. Пароли, токены.
const SECRET_KEYS: ReadonlySet<string> = new Set<string>([SETTINGS_KEYS.SMTP_PASS]);

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

export interface AppSettingAdminRow {
  key: string;
  value: string | null; // null если isSecret — значение не возвращается админу в UI.
  description: string | null;
  isSecret: boolean;
  hasValue: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

@Injectable()
export class AppSettingsService implements OnModuleInit {
  private readonly logger = new Logger(AppSettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SecretsService) private readonly secrets: SecretsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedSmtpFromEnvIfEmpty();
  }

  /**
   * Если в БД ещё нет ни одного smtp.* ключа — копируем текущие значения из
   * env. Пароль шифруется через SecretsService. Идемпотентно: второй раз не
   * перезапишет, потому что ключи уже есть.
   */
  private async seedSmtpFromEnvIfEmpty(): Promise<void> {
    const existing = await this.prisma.appSetting.count({
      where: { key: { startsWith: 'smtp.' } },
    });
    if (existing > 0) return;

    const rows: Array<{ key: string; value: string; description: string; isSecret: boolean }> = [
      {
        key: SETTINGS_KEYS.SMTP_HOST,
        value: process.env.SMTP_HOST ?? '',
        description: 'SMTP-сервер для отправки писем',
        isSecret: false,
      },
      {
        key: SETTINGS_KEYS.SMTP_PORT,
        value: process.env.SMTP_PORT ?? '587',
        description: 'Порт SMTP (465 для SSL, 587 для STARTTLS, 1025 для dev)',
        isSecret: false,
      },
      {
        key: SETTINGS_KEYS.SMTP_USER,
        value: process.env.SMTP_USER ?? '',
        description: 'Имя пользователя SMTP (если требуется аутентификация)',
        isSecret: false,
      },
      {
        key: SETTINGS_KEYS.SMTP_PASS,
        value: this.secrets.encrypt(process.env.SMTP_PASS ?? ''),
        description: 'Пароль SMTP (хранится зашифрованно)',
        isSecret: true,
      },
      {
        key: SETTINGS_KEYS.SMTP_FROM,
        value: process.env.SMTP_FROM ?? 'GMD <no-reply@gmd.local>',
        description: 'Адрес отправителя (From) для всех исходящих писем',
        isSecret: false,
      },
    ];

    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.appSetting.create({
          data: { ...r, updatedBy: 'system:seed' },
        }),
      ),
    );
    this.logger.log(`Seeded ${rows.length} smtp.* settings from env`);
  }

  async getString(key: string, fallback: string): Promise<string> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    let value = row?.value ?? fallback;
    if (row?.isSecret) {
      try {
        value = this.secrets.decrypt(value);
      } catch (e) {
        this.logger.error(`Failed to decrypt secret "${key}": ${(e as Error).message}`);
        value = fallback;
      }
    }
    this.cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.getString(key, String(fallback));
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Возвращает все настройки для админки. value у секретных ключей заменяется
   * на null (показываем лишь флаг hasValue), чтоб не светить пароли даже
   * админу.
   */
  async listForAdmin(): Promise<AppSettingAdminRow[]> {
    const rows = await this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({
      key: r.key,
      value: r.isSecret ? null : r.value,
      description: r.description,
      isSecret: r.isSecret,
      hasValue: r.isSecret ? r.value.length > 0 : r.value.length > 0,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedBy,
    }));
  }

  async update(key: string, value: string, updatedBy: string): Promise<void> {
    const existing = await this.prisma.appSetting.findUnique({ where: { key } });
    const isSecret = existing?.isSecret ?? SECRET_KEYS.has(key);

    // Для секретов пустое value трактуется как «не менять» — иначе невозможно
    // редактировать остальные поля, не перевводя пароль каждый раз.
    if (isSecret && value.length === 0) return;

    const storedValue = isSecret ? this.secrets.encrypt(value) : value;

    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value: storedValue, updatedBy, isSecret },
      // Новые ключи не должны создаваться через UI — только через миграции/seed.
      create: { key, value: storedValue, updatedBy, description: null, isSecret },
    });
    this.cache.delete(key);
  }

  // Для тестов и ручной инвалидации.
  clearCache(): void {
    this.cache.clear();
  }
}
