import { z } from 'zod';

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10).max(500),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
