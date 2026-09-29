import { z } from 'zod';

export const ZonesEventsQuerySchema = z
  .object({
    childId: z.string().cuid().optional(),
    zoneId: z.string().cuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    // Непрозрачный курсор из nextCursor: пара (recordedAt, id).
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().gte(1).lte(100).default(50),
  })
  .strict();

export type ZonesEventsQuery = z.infer<typeof ZonesEventsQuerySchema>;
