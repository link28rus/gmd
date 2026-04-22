import { z } from 'zod';

const nameField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((s) => !/[<>"\\]/.test(s), { message: 'Invalid characters in name' });

export const RegisterSchema = z
  .object({
    lastName: nameField,
    firstName: nameField,
    middleName: nameField.optional().or(z.literal('').transform(() => undefined)),
    familyName: z
      .string()
      .trim()
      .max(80)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    email: z.string().email().max(320).toLowerCase().trim(),
    password: z.string().min(8).max(128),
    passwordConfirm: z.string().min(8).max(128),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Пароли не совпадают',
    path: ['passwordConfirm'],
  });

export type RegisterDto = z.infer<typeof RegisterSchema>;
