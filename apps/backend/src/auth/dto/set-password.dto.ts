import { z } from 'zod';

export const SetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
});
export type SetPasswordDto = z.infer<typeof SetPasswordSchema>;
