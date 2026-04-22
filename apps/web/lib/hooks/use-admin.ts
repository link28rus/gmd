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

export function useAdminFamilies({
  page = 1,
  limit = 50,
  q = '',
  showDeleted = false,
}: {
  page?: number;
  limit?: number;
  q?: string;
  showDeleted?: boolean;
} = {}) {
  return useQuery({
    queryKey: ['admin', 'families', page, q, showDeleted],
    queryFn: () => adminApi.listFamilies({ page, limit, q, showDeleted }),
  });
}

export function useAdminChildren({
  page = 1,
  limit = 50,
  q = '',
  showDeleted = false,
}: {
  page?: number;
  limit?: number;
  q?: string;
  showDeleted?: boolean;
} = {}) {
  return useQuery({
    queryKey: ['admin', 'children', page, q, showDeleted],
    queryFn: () => adminApi.listChildren({ page, limit, q, showDeleted }),
  });
}

export function useAdminInvites() {
  return useQuery({
    queryKey: ['admin', 'invites'],
    queryFn: adminApi.listActiveInvites,
  });
}
