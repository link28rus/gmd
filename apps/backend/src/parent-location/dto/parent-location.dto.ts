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

export const IngestParentLocationsSchema = z
  .object({
    points: z.array(ParentLocationPointSchema).min(1),
  })
  .strict();

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

/** Как у ребёнка: офлайн-очередь телефона выгружается пачкой. */
export const MAX_PARENT_BATCH_SIZE = 500;
