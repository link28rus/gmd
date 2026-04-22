import { z } from 'zod';

export const ConfirmEmailSchema = z.object({
  token: z.string().min(32).max(128),
});

export type ConfirmEmailDto = z.infer<typeof ConfirmEmailSchema>;
