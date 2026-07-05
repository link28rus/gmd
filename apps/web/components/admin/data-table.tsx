// apps/web/components/admin/data-table.tsx
'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** Если задан — заголовок кликабелен и сортирует по этому серверному полю. */
  sortKey?: string;
  align?: 'left' | 'right';
  /** Доп. классы для ячеек колонки (не заголовка). */
  cellClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  sort?: { by: string; dir: SortDir };
  onSort?: (sortKey: string) => void;
  /** Ключ для React (по умолчанию индекс). */
  rowKey?: (row: T, i: number) => string;
}

export function DataTable<T>({
  columns,
  rows,
  empty = 'Нет данных',
  sort,
  onSort,
  rowKey,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left">
            {columns.map((col) => {
              const sortable = Boolean(col.sortKey && onSort);
              const isActive = sort?.by === col.sortKey;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(col.sortKey as string)}
                      className={cn(
                        'group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground',
                        col.align === 'right' && 'flex-row-reverse',
                        isActive && 'text-foreground',
                      )}
                    >
                      {col.header}
                      {isActive ? (
                        sort?.dir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40 group-hover:opacity-70" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : i}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-2.5 align-middle text-foreground',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      col.cellClassName,
                    )}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
