import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../common/secrets/secrets.service';

// Ключи app_settings, которые знает backend. Добавляем сюда — получаем getter.
export const SETTINGS_KEYS = {
  TRIP_IDLE_MINUTES: 'trip.idle_minutes',
  TRIP_IDLE_RADIUS_M: 'trip.idle_radius_m',
  // v0.31.3 — backend-фильтрация GPS-шума (Этап 1 вынесения mobile-порогов в
  // админку). Mobile-клиент эти ключи пока не читает — только backend при
  // ingest'е.
  LOCATION_ACCURACY_FLOOR_M: 'location.accuracy_floor_m',
  LOCATION_JITTER_WINDOW_MS: 'location.jitter_window_ms',
  LOCATION_JITTER_MIN_DIST_M: 'location.jitter_min_dist_m',
  SMTP_HOST: 'smtp.host',
  SMTP_PORT: 'smtp.port',
  SMTP_USER: 'smtp.user',
  SMTP_PASS: 'smtp.pass',
  SMTP_FROM: 'smtp.from',
  // Audio (Phase 5.2)
  AUDIO_DEFAULT_DURATION_SEC: 'audio.default_duration_sec',
  AUDIO_MAX_DURATION_SEC: 'audio.max_duration_sec',
  AUDIO_MIN_DURATION_SEC: 'audio.min_duration_sec',
  AUDIO_HIDDEN_MODE_ALLOWED: 'audio.hidden_mode_allowed',
  AUDIO_CHILD_READY_TIMEOUT_SEC: 'audio.child_ready_timeout_sec',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

// Ключи, которые при обновлении должны шифроваться. Пароли, токены.
const SECRET_KEYS: ReadonlySet<string> = new Set<string>([SETTINGS_KEYS.SMTP_PASS]);

// Диапазоны допустимых значений для числовых ключей. Проверяются в update()
// — чтобы админ случайным вводом не положил прод (например accuracy_floor_m=1
// отсеял бы всё, ingest перестал бы писать, родители увидели пустые карты).
// Диапазоны намеренно широкие — даём инструмент, но защищаем от явных крайностей.
const KEY_BOUNDS: Record<string, { min: number; max: number }> = {
  [SETTINGS_KEYS.TRIP_IDLE_MINUTES]: { min: 1, max: 180 },
  [SETTINGS_KEYS.TRIP_IDLE_RADIUS_M]: { min: 10, max: 1000 },
  [SETTINGS_KEYS.LOCATION_ACCURACY_FLOOR_M]: { min: 50, max: 500 },
  [SETTINGS_KEYS.LOCATION_JITTER_WINDOW_MS]: { min: 0, max: 300_000 },
  [SETTINGS_KEYS.LOCATION_JITTER_MIN_DIST_M]: { min: 0, max: 200 },
  [SETTINGS_KEYS.SMTP_PORT]: { min: 1, max: 65535 },
  [SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC]: { min: 30, max: 1800 },
  [SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC]: { min: 60, max: 3600 },
  [SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC]: { min: 10, max: 600 },
  [SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC]: { min: 5, max: 120 },
};

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
    await this.seedLocationFiltersIfEmpty();
    await this.seedAudioIfEmpty();
  }

  /**
   * v0.31.3 — seed backend-фильтрации GPS-шума. Значения совпадают с хардкодом
   * из предыдущих версий `LocationsService.ingestBatch`, чтобы обновление
   * не меняло поведение. Идемпотентно.
   */
  private async seedLocationFiltersIfEmpty(): Promise<void> {
    const existing = await this.prisma.appSetting.count({
      where: { key: { startsWith: 'location.' } },
    });
    if (existing > 0) return;

    const rows: Array<{ key: string; value: string; description: string }> = [
      {
        key: SETTINGS_KEYS.LOCATION_ACCURACY_FLOOR_M,
        value: '100',
        description:
          'Максимальная погрешность точки, которую сервер сохраняет (в метрах). ' +
          'Телефон ребёнка вместе с каждой точкой присылает оценку точности GPS ' +
          '(например, «±40 м»). Точки с оценкой хуже этого порога считаются шумом ' +
          'от многократного отражения сигнала в помещении и не сохраняются. ' +
          'Пример: если выставить 100 — точки «±150 м» будут отбрасываться, ' +
          '«±30 м» (нормальный outdoor GPS) сохраняются. Слишком маленькое значение ' +
          '(например 30) потеряет точки от детей, сидящих дома; слишком большое ' +
          '(500) вернёт прежний «звёздный» шум на картах. Диапазон: 50-500.',
      },
      {
        key: SETTINGS_KEYS.LOCATION_JITTER_WINDOW_MS,
        value: '60000',
        description:
          'Окно группировки «стоячих» точек в миллисекундах. Если ребёнок физически ' +
          'не двигается (сидит дома, в школе), GPS может присылать слегка разные ' +
          'координаты каждые 10 секунд — это и есть «дрожь». Внутри этого окна ' +
          'близкие точки (см. следующий параметр) считаются одной и той же стоянкой ' +
          'и не сохраняются. Пример: 60000 = 1 минута, значит за минуту оставляем ' +
          'только одну точку если ребёнок стоит; 0 = фильтр выключен (сохраняем всё, ' +
          'как в v0.30). 300000 = 5 минут — очень агрессивная фильтрация, ' +
          'трек будет редким даже при ходьбе по комнате. Диапазон: 0-300000.',
      },
      {
        key: SETTINGS_KEYS.LOCATION_JITTER_MIN_DIST_M,
        value: '30',
        description:
          'Минимальное расстояние (в метрах), на которое ребёнок должен сдвинуться, ' +
          'чтобы новая точка считалась «движением», а не «дрожью». Работает вместе ' +
          'с окном выше. Фактический порог = max(значение_тут, 2 × accuracy_точки), ' +
          'поэтому плохие GPS-точки (±40 м) автоматически требуют бóльшего сдвига. ' +
          'Пример: 30 метров — типичная двухэтажка, дрожь ±20 м внутри не считается ' +
          'движением; 10 метров — чувствительнее, засчитает даже переход из комнаты ' +
          'в комнату; 100 метров — только явные выходы из дома попадут в трек. ' +
          'Диапазон: 0-200.',
      },
    ];

    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.appSetting.create({
          data: { ...r, isSecret: false, updatedBy: 'system:seed' },
        }),
      ),
    );
    this.logger.log(`Seeded ${rows.length} location.* settings with defaults`);
  }

  /**
   * Phase 5.2 — seed аудио-мониторинга «Звук вокруг». Идемпотентно.
   */
  private async seedAudioIfEmpty(): Promise<void> {
    const existing = await this.prisma.appSetting.count({
      where: { key: { startsWith: 'audio.' } },
    });
    if (existing > 0) return;

    const rows: Array<{ key: string; value: string; description: string }> = [
      {
        key: SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC,
        value: '300',
        description:
          'Длительность одной сессии «Звук вокруг» по умолчанию (в секундах). ' +
          '300 = 5 минут. Регулируется родителем при старте сессии в пределах ' +
          '[audio.min_duration_sec, audio.max_duration_sec]. Чем больше — тем выше ' +
          'риск убийства FGS на OEM (Xiaomi, Honor) при экономии батареи. Диапазон: 30-1800.',
      },
      {
        key: SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC,
        value: '1800',
        description:
          'Максимальная длительность одной сессии (в секундах). 1800 = 30 минут. ' +
          'Жёсткий потолок — даже если родитель попросит больше, backend обрежет. ' +
          'Защищает от случайной «вечной» прослушки и экономит батарею ребёнка. Диапазон: 60-3600.',
      },
      {
        key: SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC,
        value: '30',
        description:
          'Минимальная длительность одной сессии (в секундах). Смысла создавать сессию ' +
          'короче нет — handshake WebRTC занимает 1-3 секунды. Диапазон: 10-600.',
      },
      {
        key: SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED,
        value: 'true',
        description:
          'Можно ли использовать скрытый режим (без push/баннера ребёнку). System-level ' +
          'privacy indicator Android всё равно покажется (зелёная точка). Если false — ' +
          'каждая сессия будет уведомлять ребёнка push-уведомлением.',
      },
      {
        key: SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC,
        value: '45',
        description:
          'Таймаут ожидания ответа от child-устройства (в секундах). Если за это время ' +
          'child не прислал SDP-offer — сессия → EXPIRED. На MVP без FCM child-app узнаёт о ' +
          'новой сессии через short-poll DeviceCommand (worst-case ≈ 30 сек), плюс ~3 сек ' +
          'на WebRTC setup, плюс buffer. Default 45 сек консервативно. После внедрения FCM ' +
          '(post-MVP) можно уменьшить до 5-10 сек. Диапазон: 5-120.',
      },
    ];

    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.appSetting.create({
          data: { ...r, isSecret: false, updatedBy: 'system:seed' },
        }),
      ),
    );
    this.logger.log(`Seeded ${rows.length} audio.* settings with defaults`);
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

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.getString(key, String(fallback));
    // Принимаем строки, которые админ мог ввести: 'true', '1', 'yes', 'on'
    return ['true', '1', 'yes', 'on'].includes(raw.toLowerCase().trim());
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

    // v0.31.3 — валидация диапазонов для числовых ключей. Защищает от случайного
    // ввода значений, которые сломают прод (accuracy_floor=1 → ingest отрезает всё).
    const bounds = KEY_BOUNDS[key];
    if (bounds) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) {
        throw new BadRequestException({
          code: 'value_out_of_range',
          message: `Значение должно быть числом от ${bounds.min} до ${bounds.max}`,
          min: bounds.min,
          max: bounds.max,
        });
      }
    }

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
