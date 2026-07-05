// apps/web/lib/hooks/use-table-sort.ts
'use client';

import { useState, useCallback } from 'react';
import type { SortDir } from '@/lib/api/admin';

export interface TableSort<F extends string> {
  by: F;
  dir: SortDir;
}

/**
 * Управление состоянием сортировки таблицы. Клик по той же колонке
 * переключает направление; клик по новой — ставит её с направлением по
 * умолчанию (desc — свежее сверху).
 */
export function useTableSort<F extends string>(initial: TableSort<F>) {
  const [sort, setSort] = useState<TableSort<F>>(initial);

  const toggle = useCallback((key: string) => {
    setSort((prev) =>
      prev.by === key
        ? { by: prev.by, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { by: key as F, dir: 'desc' },
    );
  }, []);

  return { sort, toggle, setSort };
}
