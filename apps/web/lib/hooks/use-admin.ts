// apps/web/lib/hooks/use-admin.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api/admin';
import type { ChildSortField, FamilySortField, SortDir, UserSortField } from '@/lib/api/admin';

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
  showDeleted = false,
  sortBy,
  sortDir,
}: {
  page?: number;
  limit?: number;
  q?: string;
  showDeleted?: boolean;
  sortBy?: UserSortField;
  sortDir?: SortDir;
} = {}) {
  return useQuery({
    queryKey: ['admin', 'users', page, q, showDeleted, sortBy, sortDir],
    queryFn: () => adminApi.listUsers({ page, limit, q, showDeleted, sortBy, sortDir }),
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
  sortBy,
  sortDir,
}: {
  page?: number;
  limit?: number;
  q?: string;
  showDeleted?: boolean;
  sortBy?: FamilySortField;
  sortDir?: SortDir;
} = {}) {
  return useQuery({
    queryKey: ['admin', 'families', page, q, showDeleted, sortBy, sortDir],
    queryFn: () => adminApi.listFamilies({ page, limit, q, showDeleted, sortBy, sortDir }),
  });
}

export function useAdminChildren({
  page = 1,
  limit = 50,
  q = '',
  showDeleted = false,
  sortBy,
  sortDir,
}: {
  page?: number;
  limit?: number;
  q?: string;
  showDeleted?: boolean;
  sortBy?: ChildSortField;
  sortDir?: SortDir;
} = {}) {
  return useQuery({
    queryKey: ['admin', 'children', page, q, showDeleted, sortBy, sortDir],
    queryFn: () => adminApi.listChildren({ page, limit, q, showDeleted, sortBy, sortDir }),
  });
}

export function useAdminInvites({
  page = 1,
  limit = 50,
  q = '',
}: { page?: number; limit?: number; q?: string } = {}) {
  return useQuery({
    queryKey: ['admin', 'invites', page, q],
    queryFn: () => adminApi.listInvites({ page, limit, q }),
  });
}
