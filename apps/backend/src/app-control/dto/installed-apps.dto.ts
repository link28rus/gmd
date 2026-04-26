import { z } from 'zod';

// POST /child/installed-apps body — snapshot всех установленных у ребёнка apps.
// Шлёт InstalledAppsWorker раз в сутки + при первом запуске + при смене user-id
// (multi-user Android, but unused в нашем MVP).
//
// Лимиты:
//   - max 1000 apps per request (на самом деле обычно 100-300, лимит для DoS-защиты)
//   - timezone IANA, max 64 char
//
// Backend выполняет UPSERT по (childDeviceId, packageName):
//   - пакет уже есть → UPDATE lastSeenAt = NOW(), appLabel/iconSha256/category
//   - нет → INSERT
//   - apps в БД, но НЕТ в payload и lastSeenAt < NOW()-7d → можно считать удалёнными
//     (cleanup на стороне UI парента — рисуем серым; жёсткого DELETE не делаем).
export const InstalledAppsBodySchema = z
  .object({
    timezone: z.string().min(1).max(64),
    apps: z
      .array(
        z
          .object({
            packageName: z.string().min(1).max(255),
            appLabel: z.string().min(1).max(255),
            iconSha256: z
              .string()
              .regex(/^[0-9a-f]{64}$/, 'must be lowercase hex sha256')
              .nullable()
              .optional(),
            isSystem: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

export type InstalledAppsBody = z.infer<typeof InstalledAppsBodySchema>;
