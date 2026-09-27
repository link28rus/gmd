import type { GmdTheme } from '@/components/theme/theme-provider';

export interface TileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

/**
 * Конфиг tile-сервера для карт кабинета.
 *
 * Во всех темах — стандартный OSM (tile.openstreetmap.org), ключ не нужен.
 * Тёмный вид для `dim` / `dark` делается CSS-фильтром на `.leaflet-tile-pane`
 * в `app/globals.css` — фильтр не задевает маркеры, треки и круги геозон
 * (они в других pane'ах).
 *
 * CartoDB (Voyager / Dark Matter) больше не используем: с 2026-09 CARTO
 * требует API-ключ и без него отдаёт тайл-заглушку «API KEY REQUIRED».
 *
 * `theme` оставлен в сигнатуре, чтобы подложку можно было снова развести
 * по темам без правки трёх компонентов карты. Если URL начнёт зависеть от
 * темы — TileLayer пере-маунтится сам через `key={tile.url}`.
 */
export function tileConfigFor(_theme: GmdTheme): TileConfig {
  return {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  };
}
