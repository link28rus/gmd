import { z } from 'zod';

export const VerifyOtpSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export type VerifyOtpDto = z.infer<typeof VerifyOtpSchema>;
