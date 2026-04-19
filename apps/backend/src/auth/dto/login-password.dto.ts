import { z } from 'zod';

export const LoginPasswordSchema = z.object({
  email: z.string().email().max(320).toLowerCase().trim(),
  password: z.string().min(8).max(128),
});
export type LoginPasswordDto = z.infer<typeof LoginPasswordSchema>;
