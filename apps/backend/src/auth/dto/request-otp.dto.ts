import { z } from 'zod';

export const RequestOtpSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
});
export type RequestOtpDto = z.infer<typeof RequestOtpSchema>;
