import { z } from 'zod';

export const ListLocationsQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().datetime().optional(),
    limit: z.coerce.number().int().gte(1).lte(2000).default(500),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type ListLocationsQuery = z.infer<typeof ListLocationsQuerySchema>;
