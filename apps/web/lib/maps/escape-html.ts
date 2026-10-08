// apps/web/lib/maps/escape-html.ts

/** Экранирование текста для HTML DivIcon'ов Leaflet (имена, src аватара). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
