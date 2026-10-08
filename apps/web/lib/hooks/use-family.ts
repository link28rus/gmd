'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { familyApi } from '@/lib/api/family';

export const FAMILY_KEY = ['family'] as const;
const MEMBERS_KEY = [...FAMILY_KEY, 'members'] as const;
const INVITES_KEY = [...FAMILY_KEY, 'member-invites'] as const;

export function useFamilyMembers() {
  return useQuery({ queryKey: MEMBERS_KEY, queryFn: familyApi.getMembers });
}

/** Активные приглашения — только владельцу (иначе backend отвечает 403). */
export function useMemberInvites(enabled: boolean) {
  return useQuery({ queryKey: INVITES_KEY, queryFn: familyApi.listMemberInvites, enabled });
}

function useFamilyMutation<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: FAMILY_KEY }),
  });
}

export function useCreateMemberInvite() {
  return useFamilyMutation<Awaited<ReturnType<typeof familyApi.createMemberInvite>>, void>(() =>
    familyApi.createMemberInvite(),
  );
}

export function useRevokeMemberInvite() {
  return useFamilyMutation(familyApi.revokeMemberInvite);
}

export function useRemoveMember() {
  return useFamilyMutation(familyApi.removeMember);
}

export function useRenameFamily() {
  return useFamilyMutation(({ id, name }: { id: string; name: string }) =>
    familyApi.renameFamily(id, name),
  );
}
