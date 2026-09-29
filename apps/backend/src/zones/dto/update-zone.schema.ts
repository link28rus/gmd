import { z } from 'zod';
import { ZONE_COLORS, ZONE_ICONS, MIN_RADIUS_M, MAX_RADIUS_M } from './constants';
import {
  childIdsSchema,
  timezoneSchema,
  ZoneArrivalSchema,
  ZoneScheduleSchema,
} from './zone-rules.schema';

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
    // v0.65.0: null — снять расписание / срок.
    timezone: timezoneSchema.nullable().optional(),
    schedule: ZoneScheduleSchema.nullable().optional(),
    arrival: ZoneArrivalSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type UpdateZoneDto = z.infer<typeof UpdateZoneSchema>;
