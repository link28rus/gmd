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
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted text-left">
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-b border-border px-4 py-2.5 font-medium text-foreground"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-muted">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 text-foreground">
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
