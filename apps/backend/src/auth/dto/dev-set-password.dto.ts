import { z } from 'zod';

export const DevSetPasswordSchema = z.object({
  email: z.string().email().max(320).toLowerCase().trim(),
  password: z.string().min(8).max(128),
});
export type DevSetPasswordDto = z.infer<typeof DevSetPasswordSchema>;
