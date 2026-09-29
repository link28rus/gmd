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

export const UpdateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: z.enum(ZONE_COLORS).optional(),
    icon: z.enum(ZONE_ICONS).optional(),
    centerLat: z.number().gte(-90).lte(90).optional(),
    centerLon: z.number().gte(-180).lte(180).optional(),
    radius: z.number().int().gte(MIN_RADIUS_M).lte(MAX_RADIUS_M).optional(),
    allChildren: z.boolean().optional(),
    childIds: childIdsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type UpdateZoneDto = z.infer<typeof UpdateZoneSchema>;
