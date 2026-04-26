// v0.38 Phase 6.1: TanStack Query hooks для «Родительский контроль».
import { useQuery } from '@tanstack/react-query';
import { appControlApi } from '../api/app-control';

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
