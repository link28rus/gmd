import { z } from 'zod';

export const CreateChildSchema = z
  .object({
    name: z.string().min(1).max(120),
    dateOfBirth: z
      .string()
      .date()
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
  })
  .strict();
export type CreateChildDto = z.infer<typeof CreateChildSchema>;
