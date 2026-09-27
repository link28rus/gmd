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

const BoolFlag = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

/** Направление сортировки. Валидные поля (sortBy) проверяет сервис по whitelist'у. */
const SortDir = z
  .enum(['asc', 'desc'])
  .optional()
  .transform((v) => v ?? 'desc');

export const UsersQuerySchema = PaginationSchema.extend({
  q: z.string().optional(),
  showDeleted: BoolFlag,
  sortBy: z.string().optional(),
  sortDir: SortDir,
});
export type UsersQueryDto = z.infer<typeof UsersQuerySchema>;

export const FamiliesQuerySchema = PaginationSchema.extend({
  q: z.string().optional(),
  showDeleted: BoolFlag,
  sortBy: z.string().optional(),
  sortDir: SortDir,
});
export type FamiliesQueryDto = z.infer<typeof FamiliesQuerySchema>;

export const ChildrenQuerySchema = PaginationSchema.extend({
  q: z.string().optional(),
  showDeleted: BoolFlag,
  sortBy: z.string().optional(),
  sortDir: SortDir,
});
export type ChildrenQueryDto = z.infer<typeof ChildrenQuerySchema>;

export const InvitesQuerySchema = PaginationSchema.extend({
  q: z.string().optional(),
});
export type InvitesQueryDto = z.infer<typeof InvitesQuerySchema>;
