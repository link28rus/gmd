// apps/web/lib/admin/csv.ts
// Клиентский экспорт списка в CSV (Excel-совместимый: BOM + CRLF + ; как
// разделитель — русский Excel по умолчанию ждёт точку с запятой).

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Экранируем по RFC 4180: оборачиваем в кавычки, если есть спецсимволы.
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportRowsToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const head = columns.map((c) => escapeCell(c.header)).join(';');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.value(row))).join(';'))
    .join('\r\n');
  const csv = `﻿${head}\r\n${body}`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
