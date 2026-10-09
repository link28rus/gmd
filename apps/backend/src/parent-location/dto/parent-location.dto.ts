import { z } from 'zod';

/** v0.70.0: точка геолокации родителя (нативная служба mobile-parent). */
export const ParentLocationPointSchema = z
  .object({
    lat: z.number().gte(-90).lte(90),
    lon: z.number().gte(-180).lte(180),
    recordedAt: z.string().datetime(),
    accuracy: z.number().gte(0).optional(),
    speed: z.number().gte(0).optional(),
    bearing: z.number().gte(0).lt(360).optional(),
    batteryLevel: z.number().int().gte(0).lte(100).optional(),
    isCharging: z.boolean().optional(),
    provider: z.enum(['gps', 'fused', 'network']).optional(),
    isMock: z.boolean().optional(),
  })
  .strict();

/**
 * v0.73.0 «Найти телефон»: служба сообщает модель телефона и свой FCM-токен —
 * по нему сервер шлёт сигнал именно этому устройству.
 */
export const ParentLocationDeviceInfoSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    pushToken: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();

export const IngestParentLocationsSchema = z
  .object({
    points: z.array(ParentLocationPointSchema).min(1),
    device: ParentLocationDeviceInfoSchema.optional(),
  })
  .strict();

/** v0.73.0: подтверждение сигнала телефоном. */
export const AckSignalSchema = z.object({ signalId: z.string().min(1).max(64) }).strict();

/** v0.73.0: маршрут своего телефона за период (один день с запасом на часовой пояс). */
export const MyTrackQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    // v0.80.0: road — привязан к дорогам (по умолчанию), recorded — как записано.
    view: z.enum(['road', 'recorded']).optional(),
  })
  .strict();

/** v0.74.0: своё имя телефона; пустая строка или null — снова показывать модель. */
export const RenameDeviceSchema = z
  .object({ name: z.string().trim().max(40).nullable() })
  .strict()
  .transform((v) => ({ name: v.name ? v.name : null }));

export const CreateParentLocationDeviceSchema = z
  .object({
    platform: z.string().trim().min(1).max(32).optional(),
    appVersion: z.string().trim().min(1).max(64).optional(),
    replaceDeviceId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const SetSharingSchema = z.object({ enabled: z.boolean() }).strict();

export type ParentLocationPoint = z.infer<typeof ParentLocationPointSchema>;
export type IngestParentLocationsDto = z.infer<typeof IngestParentLocationsSchema>;
export type CreateParentLocationDeviceDto = z.infer<typeof CreateParentLocationDeviceSchema>;
export type SetSharingDto = z.infer<typeof SetSharingSchema>;
export type ParentLocationDeviceInfo = z.infer<typeof ParentLocationDeviceInfoSchema>;
export type AckSignalDto = z.infer<typeof AckSignalSchema>;
export type MyTrackQueryDto = z.infer<typeof MyTrackQuerySchema>;
export type RenameDeviceDto = z.output<typeof RenameDeviceSchema>;

/** Как у ребёнка: офлайн-очередь телефона выгружается пачкой. */
export const MAX_PARENT_BATCH_SIZE = 500;
