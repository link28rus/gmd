import { z } from 'zod';
import { TimezoneSchema } from './app-control-state.dto';

// POST /child/usage-reports body — часовые bucket'ы использования за дату.
// Шлёт UsageStatsWorker раз в 15 мин (текущий день) + ретроспектива при первом
// запуске (последние 7 дней одним батчем по дате).
//
// Семантика:
//   - date/hour = местное время в момент использования; история при смене TZ не сдвигается
//   - hour = 0..23 в той же TZ
//   - seconds = суммарное foreground-time в этом часе для этого пакета
//   - источник = хеш привязки + epoch периода TZ/часов; вклад источника только растёт
//   - итог = сумма вкладов; повтор и запоздалый меньший отчёт не уменьшают итог
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
    epoch: z.string().min(1).max(32).default('legacy'),
    seconds: z.number().int().min(0).max(7200), // Повтор часа при переходе DST.
  })
  .strict();

export const USAGE_WINDOW_MS = 15 * 60_000;
export const USAGE_WINDOW_RETENTION_MS = 30 * 86_400_000;
const offset = z.number().int().min(0).max(USAGE_WINDOW_MS);
export const UsageSegmentsSchema = z
  .array(z.tuple([z.string().min(1).max(255), offset, offset]))
  .max(128)
  .refine(
    (segments) =>
      segments.every(([, from, to], i) => from < to && (i === 0 || from >= segments[i - 1][2])),
    'Usage segments must be ordered and non-overlapping',
  );

const UsageWindowSchema = z
  .object({
    startMs: z.number().int().safe().nonnegative().multipleOf(USAGE_WINDOW_MS),
    segments: UsageSegmentsSchema,
  })
  .strict();

export const UsageReportBodySchema = z
  .object({
    timezone: TimezoneSchema,
    buckets: z.array(UsageReportBucketSchema).max(24_000),
    windows: z.array(UsageWindowSchema).max(32).optional(),
  })
  .strict();

export type UsageReportBody = z.infer<typeof UsageReportBodySchema>;
export type UsageReportBucket = z.infer<typeof UsageReportBucketSchema>;
