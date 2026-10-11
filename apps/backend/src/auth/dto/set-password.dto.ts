import { z } from 'zod';

export const SetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
  // Обязателен, если у пользователя уже есть пароль (проверяет AuthService).
  currentPassword: z.string().min(1).max(128).optional(),
});
export type SetPasswordDto = z.infer<typeof SetPasswordSchema>;
