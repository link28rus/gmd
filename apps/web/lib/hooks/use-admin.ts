// apps/web/lib/hooks/use-admin.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin';

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: adminApi.stats,
  });
}

export function useAdminUsers({
  page = 1,
  limit = 50,
  q = '',
}: {
  page?: number;
  limit?: number;
  q?: string;
} = {}) {
  return useQuery({
    queryKey: ['admin', 'users', page, q],
    queryFn: () => adminApi.listUsers({ page, limit, q }),
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: () => adminApi.getUserDetail(id),
    enabled: Boolean(id),
  });
}

export function useAdminFamilies({ page = 1, limit = 50 }: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ['admin', 'families', page],
    queryFn: () => adminApi.listFamilies({ page, limit }),
  });
}

export function useAdminChildren({ page = 1, limit = 50 }: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ['admin', 'children', page],
    queryFn: () => adminApi.listChildren({ page, limit }),
  });
}

export function useAdminInvites() {
  return useQuery({
    queryKey: ['admin', 'invites'],
    queryFn: adminApi.listActiveInvites,
  });
}
