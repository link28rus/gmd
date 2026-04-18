// apps/web/components/admin/data-table.tsx
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  empty = 'Нет данных',
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 text-left">
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-b border-zinc-200 px-4 py-2.5 font-medium text-zinc-700"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-zinc-400">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 text-zinc-800">
                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
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
