import { z } from 'zod';

export const SosSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  recordedAt: z.string().datetime(),
  message: z.string().max(500).optional(),
});

export type SosDto = z.infer<typeof SosSchema>;
