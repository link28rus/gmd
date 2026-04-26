import { z } from 'zod';

// POST /family/children/:childId/app-control/block-sessions
//
// Семантика:
//   - durationMin: длительность блокировки от 5 мин до 24 ч (UI step 5/60 мин,
//     backend принимает любое целое в диапазоне). startedAt = now(),
//     endsAt = startedAt + durationMin * 60_000.
//   - Backend отказывает (409 session_already_active) если для child уже есть
//     state=ACTIVE сессия с endsAt > now (даже если cron ещё не успел её
//     auto-expire — сначала надо явно завершить старую).
//
// На стороне child endsAt — absolute UTC timestamp, не зависит от system clock
// manipulation: ребёнок не может «открутить часы назад» чтобы сбросить блок,
// потому что child сравнивает endsAt с serverNow (синхронизированным через
// предыдущие FCM/REST round-trip'ы).
export const CreateBlockSessionSchema = z
  .object({
    durationMin: z
      .number()
      .int()
      .min(5)
      .max(24 * 60), // 5..1440
  })
  .strict();

export type CreateBlockSessionBody = z.infer<typeof CreateBlockSessionSchema>;
