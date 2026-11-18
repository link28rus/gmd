import { z } from 'zod';

export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone });
      return true;
    } catch {
      return false;
    }
  }, 'invalid IANA timezone');

export const AppControlAckSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    accessibility: z.boolean(),
    usageStats: z.boolean(),
    timezone: TimezoneSchema,
    zoneBlockingSupported: z.literal(true).optional(),
  })
  .strict();
export type AppControlAck = z.infer<typeof AppControlAckSchema>;
