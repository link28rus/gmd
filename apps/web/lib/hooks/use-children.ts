// apps/web/lib/hooks/use-children.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { childrenApi, type CreateChildInput, type UpdateChildInput } from '@/lib/api/children';

const KEY = ['children'] as const;

export function useChildren() {
  return useQuery({
    queryKey: KEY,
    queryFn: childrenApi.list,
  });
}

function useInvalidating<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateChild() {
  return useInvalidating<unknown, CreateChildInput>(childrenApi.create);
}

export function useUpdateChild() {
  return useInvalidating<unknown, { id: string; patch: UpdateChildInput }>(({ id, patch }) =>
    childrenApi.update(id, patch),
  );
}

export function useDeleteChild() {
  return useInvalidating<unknown, string>(childrenApi.remove);
}

export function useCreateInvite() {
  // не invalidate — invite вне queries
  return useMutation({
    mutationFn: (args: { id: string; consent14PlusGranted?: boolean }) =>
      childrenApi.createInvite(args.id, { consent14PlusGranted: args.consent14PlusGranted }),
  });
}

export function useResetDevice() {
  return useInvalidating<unknown, string>(childrenApi.resetDevice);
}
