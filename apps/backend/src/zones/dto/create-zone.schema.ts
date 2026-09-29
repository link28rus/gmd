import { z } from 'zod';
import {
  ZONE_COLORS,
  ZONE_ICONS,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
  MAX_CHILDREN_PER_ZONE,
} from './constants';

// Дубли id убираем (иначе createMany назначений падал с 500).
const childIdsSchema = z
  .array(z.string().cuid())
  .max(MAX_CHILDREN_PER_ZONE)
  .transform((ids) => [...new Set(ids)]);

export const CreateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: z.enum(ZONE_COLORS),
    icon: z.enum(ZONE_ICONS),
    centerLat: z.number().gte(-90).lte(90),
    centerLon: z.number().gte(-180).lte(180),
    radius: z.number().int().gte(MIN_RADIUS_M).lte(MAX_RADIUS_M),
    // Зона для всех детей семьи, включая будущих; childIds тогда игнорируются.
    allChildren: z.boolean().default(false),
    childIds: childIdsSchema.default([]),
  })
  .strict();

export type CreateZoneDto = z.infer<typeof CreateZoneSchema>;
