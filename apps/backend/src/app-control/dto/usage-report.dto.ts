import { z } from 'zod';

// POST /child/usage-reports body — часовые bucket'ы использования за дату.
// Шлёт UsageStatsWorker раз в 15 мин (текущий день) + ретроспектива при первом
// запуске (последние 7 дней одним батчем по дате).
//
// Семантика:
//   - date = local-date в TZ ребёнка (см. ChildDevice.timezone)
//   - hour = 0..23 в той же TZ
//   - seconds = суммарное foreground-time в этом часе для этого пакета
//   - UPSERT по (childDeviceId, date, hour, packageName) — replace, не add.
//     Это потому что worker каждые 15 мин пересылает накопительный итог за час
//     (если ребёнок открыл TikTok в 14:05 на 5 мин, в 14:30 worker пришлёт 300с;
//     если в 14:40 ещё 3 мин → в 14:45 пришлёт 480с replace).
//
// Лимиты:
//   - max 7 дней в одном payload
//   - max 24*1000 = 24000 buckets в одном payload (на случай ретроспективы с
//     большим количеством apps)
export const UsageReportBucketSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    hour: z.number().int().min(0).max(23),
    packageName: z.string().min(1).max(255),
    seconds: z.number().int().min(0).max(3600),
  })
  .strict();

export const UsageReportBodySchema = z
  .object({
    timezone: z.string().min(1).max(64),
    buckets: z.array(UsageReportBucketSchema).min(1).max(24_000),
  })
  .strict();

export type UsageReportBody = z.infer<typeof UsageReportBodySchema>;
export type UsageReportBucket = z.infer<typeof UsageReportBucketSchema>;
