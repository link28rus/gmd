import { z } from 'zod';

/**
 * v0.51 RuStore Push (lesson #24): отдельный DTO для регистрации
 * RuStore-токена parent-устройства. Токен RuStore — отдельный от FCM, не
 * сравним по семантике (даже на одном устройстве с обоими каналами это
 * два разных идентификатора). При наличии — backend предпочитает RuStore
 * push (он не глушится MIUI Restricted Settings — lesson #23).
 *
 * Длина rustorePushToken ~140-200 char как у FCM; держим 20..4096 как
 * безопасный диапазон.
 */
export const RegisterRustoreTokenSchema = z.object({
  rustorePushToken: z.string().min(20).max(4096),
  platform: z.enum(['android', 'ios']),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});

export type RegisterRustoreTokenDto = z.infer<typeof RegisterRustoreTokenSchema>;
