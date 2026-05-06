import { z } from 'zod';

// POST/PATCH /family/children/:childId/app-control/schedules[/:scheduleId]
//
// Семантика полей:
//   - name: 1..64 символа, отображается в UI и push-уведомлениях.
//   - daysMask: bitmask по ISO-weekday (1=ПН … 7=ВС, bit i-1 = day i).
//     1..127 — хотя бы один день должен быть выбран. Будни=31, выходные=96, ежедневно=127.
//   - startMin/endMin: минуты с полуночи в TZ ребёнка (ChildDevice.timezone).
//     0..1439 (23:59 = 1439). end exclusive — окно включает startMin, не включает endMin.
//     startMin == endMin запрещён (zero-duration). startMin > endMin = переход через
//     полночь (e.g. 22:00 → 08:00 = startMin=1320, endMin=480).
//   - mode: на v1 только BLOCK_NON_ALLOWED — блокировать всё кроме whitelist'а
//     (= ALWAYS_ALLOWED + HARDCODED). Идентично поведению BlockSession.
//   - enabled: тумблер; disabled-расписание игнорируется устройством. Default true.
//
// Backend дополнительно валидирует:
//   - daysMask & ~127 == 0 (только младшие 7 бит)
//   - startMin/endMin в [0, 1440) (zod min/max)
//   - startMin != endMin (refine)

const TIME_MIN = 0;
const TIME_MAX = 1440; // exclusive (23:59 = 1439)
const DAYS_MASK_MIN = 1;
const DAYS_MASK_MAX = 127; // 0b1111111

const NameSchema = z.string().trim().min(1).max(64);

const DaysMaskSchema = z
  .number()
  .int()
  .min(DAYS_MASK_MIN)
  .max(DAYS_MASK_MAX)
  // дополнительная защита: только 7 младших бит (на случай, если zod-min/max
  // пропустит экзотическое значение через JSON-parse).
  .refine((v) => (v & ~DAYS_MASK_MAX) === 0, {
    message: 'daysMask must use only bits 0..6 (ISO weekday 1..7)',
  });

const TimeMinSchema = z
  .number()
  .int()
  .min(TIME_MIN)
  .max(TIME_MAX - 1);

export const CreateScheduleSchema = z
  .object({
    name: NameSchema,
    daysMask: DaysMaskSchema,
    startMin: TimeMinSchema,
    endMin: TimeMinSchema,
    enabled: z.boolean().optional().default(true),
    mode: z.enum(['BLOCK_NON_ALLOWED']).optional().default('BLOCK_NON_ALLOWED'),
  })
  .strict()
  .refine((data) => data.startMin !== data.endMin, {
    message: 'startMin must differ from endMin (zero-duration not allowed)',
    path: ['endMin'],
  });

export type CreateScheduleBody = z.infer<typeof CreateScheduleSchema>;

// PATCH — partial. Все поля optional, но как минимум одно должно быть
// указано (refine), иначе клиент шлёт пустое тело.
export const UpdateScheduleSchema = z
  .object({
    name: NameSchema.optional(),
    daysMask: DaysMaskSchema.optional(),
    startMin: TimeMinSchema.optional(),
    endMin: TimeMinSchema.optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(['BLOCK_NON_ALLOWED']).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  })
  .refine(
    (data) =>
      data.startMin === undefined || data.endMin === undefined || data.startMin !== data.endMin,
    {
      message: 'startMin must differ from endMin',
      path: ['endMin'],
    },
  );

export type UpdateScheduleBody = z.infer<typeof UpdateScheduleSchema>;

// Public DTO (response shape). Время в минутах + строковом формате "HH:MM"
// для удобства фронта (избегаем повторной форматирующей логики).
export interface AppBlockScheduleDto {
  id: string;
  name: string;
  enabled: boolean;
  daysMask: number;
  startMin: number;
  endMin: number;
  /** "HH:MM" представление startMin */
  startTime: string;
  /** "HH:MM" представление endMin */
  endTime: string;
  /** true если startMin > endMin (окно пересекает полночь) */
  crossesMidnight: boolean;
  mode: 'BLOCK_NON_ALLOWED';
  createdAt: string;
  updatedAt: string;
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
