import { z } from 'zod';

export const LocationPointSchema = z
  .object({
    lat: z.number().gte(-90).lte(90),
    lon: z.number().gte(-180).lte(180),
    recordedAt: z.string().datetime(),
    accuracy: z.number().gte(0).optional(),
    altitude: z.number().optional(),
    speed: z.number().gte(0).optional(),
    bearing: z.number().gte(0).lt(360).optional(),
    batteryLevel: z.number().int().gte(0).lte(100).optional(),
    isCharging: z.boolean().optional(),
    provider: z.enum(['gps', 'fused', 'network']).optional(),
    networkType: z.enum(['wifi', 'mobile', 'offline', 'unknown']).optional(),
    wifiSsid: z.string().max(64).optional(),
    mobileOperator: z.string().max(64).optional(),
  })
  .strict();

export const IngestLocationsSchema = z
  .object({
    points: z.array(LocationPointSchema).min(1),
  })
  .strict();

export type LocationPoint = z.infer<typeof LocationPointSchema>;
export type IngestLocationsDto = z.infer<typeof IngestLocationsSchema>;

export const MAX_BATCH_SIZE = 100;
