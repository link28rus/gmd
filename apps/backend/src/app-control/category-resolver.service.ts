import { Injectable, Logger } from '@nestjs/common';
import categoriesRaw from './seed/app-categories.json';

// Канонический список категорий. Если что-то не нашли в seed — 'other'.
// Порядок здесь же используется для сортировки чипов в UI парента.
export const CATEGORIES = [
  'social',
  'messengers',
  'video',
  'games',
  'browsers',
  'education',
  'music',
  'navigation',
  'shopping',
  'system',
  'other',
] as const;

export type AppCategory = (typeof CATEGORIES)[number];

interface CategoriesSeed {
  _comment?: string;
  [k: string]: string[] | string | undefined;
}

/**
 * Резолвит package → category по статичному JSON-справочнику.
 * Справочник: src/app-control/seed/app-categories.json (топ-200 RU/EN apps).
 *
 * Lookup за O(1) после однократной инверсии массивов в map (lazy в конструкторе).
 * Расширение справочника — просто добавить package в нужный массив в JSON.
 */
@Injectable()
export class CategoryResolver {
  private readonly logger = new Logger(CategoryResolver.name);
  private readonly map: Map<string, AppCategory>;

  constructor() {
    this.map = new Map();
    const seed = categoriesRaw as CategoriesSeed;
    let total = 0;
    for (const cat of CATEGORIES) {
      const list = seed[cat];
      if (!Array.isArray(list)) continue;
      for (const pkg of list) {
        if (typeof pkg !== 'string' || pkg.length === 0) continue;
        if (this.map.has(pkg)) {
          this.logger.warn(
            `duplicate package in seed: ${pkg} (keeping first: ${this.map.get(pkg)!})`,
          );
          continue;
        }
        this.map.set(pkg, cat);
        total++;
      }
    }
    this.logger.log(`loaded ${total} package→category mappings (${CATEGORIES.length} categories)`);
  }

  /** Резолв package → category. Не найдено → 'other'. */
  resolve(packageName: string): AppCategory {
    return this.map.get(packageName) ?? 'other';
  }

  /** Sanity-check: размер справочника (для мониторинга). */
  size(): number {
    return this.map.size;
  }
}
