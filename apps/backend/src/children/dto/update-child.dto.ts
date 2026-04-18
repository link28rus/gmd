import { z } from 'zod';

export const UpdateChildSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    dateOfBirth: z
      .string()
      .datetime()
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
  })
  .strict();
export type UpdateChildDto = z.infer<typeof UpdateChildSchema>;
