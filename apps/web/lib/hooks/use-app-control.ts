// v0.38 Phase 6.1: TanStack Query hooks для «Родительский контроль».
// v0.39 Phase 6.2: + App Blocking (BlockSession, AppRule).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appControlApi,
  type AppRuleMode,
  type BlockSessionDto,
  type CreateScheduleBody,
  type UpdateScheduleBody,
} from '../api/app-control';

export function useInstalledApps(childId: string | null) {
  return useQuery({
    queryKey: ['app-control', 'installed-apps', childId],
    queryFn: () => appControlApi.installedApps(childId!),
    enabled: childId !== null,
    // Список apps меняется не часто (раз в сутки worker), но usage за сегодня
    // апдейтится каждые 15 мин — ставим staleTime 5 мин для UI-баланса.
    staleTime: 5 * 60_000,
  });
}

export function useUsage(childId: string | null, range: 'day' | 'week', date?: string) {
  return useQuery({
    queryKey: ['app-control', 'usage', childId, range, date ?? 'today'],
    queryFn: () => appControlApi.usage(childId!, range, date),
    enabled: childId !== null,
    staleTime: 5 * 60_000,
  });
}

// ─── Phase 6.2 (v0.39): App Blocking ───────────────────────────────────────

/**
 * Активная BlockSession для child. null если нет.
 *
 * refetchInterval 30 сек — backend сам помечает EXPIRED через pg_cron каждую
 * минуту + on-read через getActiveSession. Если сессия истекла, UI обновится
 * за 30 сек без перезагрузки страницы. Само время «осталось N мин» считаем
 * на клиенте каждую секунду через setInterval — отдельный хук.
 */
export function useActiveBlock(childId: string | null) {
  return useQuery({
    queryKey: ['app-control', 'active-block', childId],
    queryFn: () => appControlApi.activeBlockSession(childId!),
    enabled: childId !== null,
    refetchInterval: 30_000,
    staleTime: 0, // важно знать актуальное состояние сразу
  });
}

export function useAppRules(childId: string | null) {
  return useQuery({
    queryKey: ['app-control', 'app-rules', childId],
    queryFn: () => appControlApi.listAppRules(childId!),
    enabled: childId !== null,
    staleTime: 5 * 60_000,
  });
}

/**
 * Создать BlockSession. После успеха инвалидирует useActiveBlock — UI сразу
 * увидит активную сессию (без ожидания 30-сек poll).
 */
export function useCreateBlock(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (durationMin: number) => appControlApi.createBlockSession(childId, durationMin),
    onSuccess: (data: BlockSessionDto) => {
      qc.setQueryData(['app-control', 'active-block', childId], data);
    },
  });
}

/**
 * Завершить активную сессию. После успеха ставим null в кэш — счётчик
 * мгновенно исчезает.
 */
export function useStopBlock(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => appControlApi.stopBlockSession(childId, sessionId),
    onSuccess: () => {
      qc.setQueryData(['app-control', 'active-block', childId], null);
    },
  });
}

/**
 * UPSERT правила {packageName × mode}. После успеха инвалидирует useAppRules
 * — список «не блокируется» обновится автоматически.
 */
export function useUpsertAppRule(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { packageName: string; mode: AppRuleMode }) =>
      appControlApi.putAppRule(childId, params.packageName, params.mode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['app-control', 'app-rules', childId] });
    },
  });
}

// ─── Phase 6.x (v0.48): Schedules ───────────────────────────────────────

const schedulesKey = (childId: string | null) => ['app-control', 'schedules', childId] as const;

export function useSchedules(childId: string | null) {
  return useQuery({
    queryKey: schedulesKey(childId),
    queryFn: () => appControlApi.listSchedules(childId!),
    enabled: childId !== null,
    // Список меняется только при действиях родителя — staleTime повыше,
    // refetch on mount достаточно.
    staleTime: 60_000,
  });
}

export function useCreateSchedule(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScheduleBody) => appControlApi.createSchedule(childId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulesKey(childId) });
    },
  });
}

export function useUpdateSchedule(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { scheduleId: string; body: UpdateScheduleBody }) =>
      appControlApi.updateSchedule(childId, params.scheduleId, params.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulesKey(childId) });
    },
  });
}

export function useDeleteSchedule(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => appControlApi.deleteSchedule(childId, scheduleId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulesKey(childId) });
    },
  });
}
