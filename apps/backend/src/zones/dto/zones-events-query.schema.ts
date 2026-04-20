import { z } from 'zod';

export const ZonesEventsQuerySchema = z
  .object({
    childId: z.string().cuid().optional(),
    zoneId: z.string().cuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().datetime().optional(),
    limit: z.coerce.number().int().gte(1).lte(100).default(50),
  })
  .strict();

export type ZonesEventsQuery = z.infer<typeof ZonesEventsQuerySchema>;
