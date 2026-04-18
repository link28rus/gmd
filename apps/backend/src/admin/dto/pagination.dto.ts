import { z } from 'zod';

export const PaginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().int().min(1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(100)),
});

export type PaginationDto = z.infer<typeof PaginationSchema>;

export const UsersQuerySchema = PaginationSchema.extend({
  q: z.string().optional(),
});

export type UsersQueryDto = z.infer<typeof UsersQuerySchema>;
