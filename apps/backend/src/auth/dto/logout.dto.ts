import { z } from 'zod';

export const LogoutSchema = z.object({
  refreshToken: z.string().min(10).max(500),
});
export type LogoutDto = z.infer<typeof LogoutSchema>;
