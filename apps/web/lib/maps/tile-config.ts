import type { GmdTheme } from '@/components/theme/theme-provider';

export interface TileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

/**
 * Конфиг tile-сервера в зависимости от темы интерфейса.
 *
 * - `light` → стандартный OSM (tile.openstreetmap.org).
 * - `dim`   → CartoDB Voyager — нейтральный бежево-серый стиль.
 *             Заметно мягче стандартного OSM, но не чёрный.
 * - `dark`  → CartoDB Dark Matter — настоящая тёмная подложка.
 *
 * Все три варианта бесплатны, без API-ключа. Атрибуция CARTO/OSM обязательна.
 *
 * При смене темы leaflet TileLayer должен пере-маунтиться (через `key` prop) —
 * иначе он продолжит тянуть тайлы со старого URL.
 */
export function tileConfigFor(theme: GmdTheme): TileConfig {
  if (theme === 'light') {
    return {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    };
  }
  if (theme === 'dim') {
    return {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    };
  }
  return {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  };
}
