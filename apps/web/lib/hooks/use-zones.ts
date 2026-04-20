// apps/web/lib/hooks/use-zones.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zonesApi, type CreateZoneInput, type UpdateZoneInput } from '@/lib/api/zones';

const KEY = ['zones'] as const;

export function useZones() {
  return useQuery({
    queryKey: KEY,
    queryFn: zonesApi.list,
  });
}

function useInvalidating<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateZone() {
  return useInvalidating<unknown, CreateZoneInput>(zonesApi.create);
}

export function useUpdateZone() {
  return useInvalidating<unknown, { id: string; patch: UpdateZoneInput }>(({ id, patch }) =>
    zonesApi.update(id, patch),
  );
}

export function useDeleteZone() {
  return useInvalidating<unknown, string>(zonesApi.remove);
}
