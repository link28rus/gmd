import { z } from 'zod';

// GET /children/:id/trips?from&to — список поездок. Аудит 2026-10-12: раньше
// query шёл в new Date() без проверки, `from=abc` давал Invalid Date → 500.
// Не strict: лишние параметры (кэш-бастеры и т.п.) не ломают запрос.
export const ListTripsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type ListTripsQuery = z.infer<typeof ListTripsQuerySchema>;
