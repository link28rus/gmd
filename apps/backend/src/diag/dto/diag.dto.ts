import { z } from 'zod';
import { DIAG_CATEGORIES } from '../diag-config';

/** Лимиты тела `POST /child/diag/logs` (символы строки). */
export const DIAG_LIMITS = {
  trigger: 64,
  commandId: 64,
  appVersion: 32,
  snapshot: 64 * 1024,
  log: 2 * 1024 * 1024,
  logcat: 2 * 1024 * 1024,
} as const;

const CategoriesSchema = z.array(z.enum(DIAG_CATEGORIES)).max(DIAG_CATEGORIES.length * 2);

/** `PATCH /admin/children/:id/diag/config` — полный DiagConfig. */
export const DiagConfigSchema = z
  .object({
    send: CategoriesSchema,
    debug: CategoriesSchema,
    debugUntil: z.string().datetime({ offset: true }).nullable(),
    logcat: z.boolean(),
    snapshot: z.boolean(),
    autoUpload: z.boolean(),
  })
  .strict();
export type DiagConfigDto = z.infer<typeof DiagConfigSchema>;

// Необязательная строка: телефон может прислать поле как null или не прислать.
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

/**
 * `POST /child/diag/logs`. Лишние поля не валят загрузку (strip, а не strict):
 * журнал нужен именно тогда, когда что-то пошло не так, в том числе на
 * версии телефона новее сервера.
 */
export const UploadDiagLogSchema = z.object({
  reason: z.enum(['manual', 'auto']),
  trigger: optionalText(DIAG_LIMITS.trigger),
  commandId: optionalText(DIAG_LIMITS.commandId),
  appVersion: optionalText(DIAG_LIMITS.appVersion),
  snapshot: optionalText(DIAG_LIMITS.snapshot),
  log: optionalText(DIAG_LIMITS.log),
  logcat: optionalText(DIAG_LIMITS.logcat),
});
export type UploadDiagLogDto = z.infer<typeof UploadDiagLogSchema>;
