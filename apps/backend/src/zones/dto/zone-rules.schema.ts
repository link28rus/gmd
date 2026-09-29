import { z } from 'zod';
import {
  MAX_CHILDREN_PER_ZONE,
  MAX_ARRIVAL_GRACE_MIN,
  DEFAULT_ARRIVAL_GRACE_MIN,
} from './constants';

// Дубли id убираем (иначе createMany назначений падал с 500).
export const childIdsSchema = z
  .array(z.string().cuid())
  .max(MAX_CHILDREN_PER_ZONE)
  .transform((ids) => [...new Set(ids)]);

const minuteOfDay = z.number().int().gte(0).lte(1439);
/** Маска дней: бит0 = ПН … бит6 = ВС. */
const daysMask = z.number().int().gte(1).lte(127);

/** v0.65.0: окно уведомлений о приходе/уходе; через полночь — если endMin < startMin. */
export const ZoneScheduleSchema = z
  .object({ daysMask, startMin: minuteOfDay, endMin: minuteOfDay })
  .strict()
  .refine((s) => s.startMin !== s.endMin, { message: 'startMin must differ from endMin' });

/** v0.65.0: «не пришёл к сроку». */
export const ZoneArrivalSchema = z
  .object({
    deadlineMin: minuteOfDay,
    daysMask,
    graceMin: z.number().int().gte(0).lte(MAX_ARRIVAL_GRACE_MIN).default(DEFAULT_ARRIVAL_GRACE_MIN),
  })
  .strict();

/** IANA-пояс; корректность проверяет сервис (код invalid_timezone). */
export const timezoneSchema = z.string().trim().min(1).max(64);

export type ZoneSchedule = z.infer<typeof ZoneScheduleSchema>;
export type ZoneArrival = z.infer<typeof ZoneArrivalSchema>;
