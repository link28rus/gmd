import { z } from 'zod';

export const RegisterFcmTokenSchema = z.object({
  fcmToken: z.string().min(20).max(4096),
  platform: z.enum(['android', 'ios']),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});

export type RegisterFcmTokenDto = z.infer<typeof RegisterFcmTokenSchema>;
