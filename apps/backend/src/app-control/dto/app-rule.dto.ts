import { z } from 'zod';

// PUT /family/children/:childId/app-control/app-rules/:packageName
//
// Семантика:
//   - mode = ALWAYS_ALLOWED — попадание в whitelist (не блокируется даже при
//     активной сессии).
//   - mode = ALWAYS_BLOCKED — постоянная блокировка без сессии (v0.40 UI; в
//     v0.39 backend принимает значение, но parent UI его не выставляет).
//   - mode = DEFAULT — наследует поведение блок-сессии (= блокируется при
//     ACTIVE BlockSession).
//
// source автоматически = PARENT — endpoint предназначен только для UI парента.
// SYSTEM_DEFAULT и HARDCODED резолвятся на стороне backend (см.
// AppBlockingService.compileEffectiveRules).
//
// PUT идемпотентен: если правило уже есть — UPDATE; иначе INSERT.
// DELETE одного правила (откат к DEFAULT) реализован через PUT { mode: DEFAULT }.
export const PutAppRuleSchema = z
  .object({
    mode: z.enum(['DEFAULT', 'ALWAYS_ALLOWED', 'ALWAYS_BLOCKED']),
  })
  .strict();

export type PutAppRuleBody = z.infer<typeof PutAppRuleSchema>;
