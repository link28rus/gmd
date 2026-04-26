import { z } from 'zod';

// POST /child/app-icons body — массив новых иконок в base64.
// Шлёт InstalledAppsWorker для пакетов, у которых backend ещё не видел sha256
// (для оптимизации передачи — child хранит локально set уже отправленных
// sha256 и шлёт только новые).
//
// Лимиты:
//   - max 50 иконок в одном payload (для UX onboarding'а — первая загрузка
//     может содержать 100+ apps; child батчит по 50)
//   - каждая иконка ≤100KB raw PNG → ~133KB base64
//   - sha256 hex 64 char, должен СОВПАДАТЬ с фактическим sha256(decodedBytes);
//     backend проверяет — если не совпадает, отказ 400 (защита от подмены)
export const AppIconsBodySchema = z
  .object({
    icons: z
      .array(
        z
          .object({
            sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be lowercase hex sha256'),
            pngBase64: z
              .string()
              .min(1)
              // base64 ≈ raw * 4/3 + padding. 100KB raw ≈ 137KB base64.
              .max(150_000),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export type AppIconsBody = z.infer<typeof AppIconsBodySchema>;
