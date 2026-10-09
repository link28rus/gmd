import { z } from 'zod';

const MAX_RANGE_MS = 2 * 24 * 60 * 60 * 1000;

// v0.63.0: GET /children/:id/track?from&to — очищенный трек за период.
export const TrackQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    // v0.80.0: road — привязан к дорогам (по умолчанию), recorded — как записано.
    view: z.enum(['road', 'recorded']).optional(),
  })
  .refine((q) => new Date(q.to).getTime() > new Date(q.from).getTime(), {
    message: 'to must be after from',
  })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= MAX_RANGE_MS, {
    message: 'range must not exceed 2 days',
  });

export type TrackQuery = z.infer<typeof TrackQuerySchema>;
