import { z } from 'zod';
import { timezoneSchema } from './zone-rules.schema';

// v0.67.0 (геозоны v2, этап 4): подсказки мест и статистика визитов.

/** Пояс родителя (браузер / телефон) — по нему считаются ночь и будни. */
export const ZonePlacesQuerySchema = z.object({ tz: timezoneSchema.optional() }).strict();
export type ZonePlacesQuery = z.infer<typeof ZonePlacesQuerySchema>;

export const PLACE_KINDS = ['home', 'school', 'frequent'] as const;

export const DismissPlaceSchema = z
  .object({
    kind: z.enum(PLACE_KINDS),
    centerLat: z.number().gte(-90).lte(90),
    centerLon: z.number().gte(-180).lte(180),
  })
  .strict();
export type DismissPlaceDto = z.infer<typeof DismissPlaceSchema>;

export interface PlaceSuggestionChildDto {
  childId: string;
  /** Засчитанных дней: ночей (дом), будней (школа), дней (частое место). */
  days: number;
  /** Дней с точками за период — знаменатель «N из M». */
  daysWithData: number;
  /** Обычное время прихода и ухода, минута дня; у дома — null. */
  typicalFromMin: number | null;
  typicalToMin: number | null;
}

export interface PlaceSuggestionDto {
  /** Стабильный ключ для списка на клиенте: вид + округлённый центр. */
  id: string;
  kind: (typeof PLACE_KINDS)[number];
  /** Предлагаемые название, иконка и цвет зоны. У частого места имя пустое. */
  name: string;
  icon: string;
  color: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  childIds: string[];
  children: PlaceSuggestionChildDto[];
}

export interface ZoneChildStatsDto {
  childId: string;
  visits: number;
  totalSec: number;
  avgSec: number;
  daysCount: number;
  lastVisitFrom: string | null;
  lastVisitTo: string | null;
  /** Ребёнок в зоне прямо сейчас (последний визит не закончился). */
  ongoing: boolean;
  typicalArrivalMin: number | null;
  typicalDepartureMin: number | null;
}

export interface ZoneStatsDto {
  zoneId: string;
  periodDays: number;
  timezone: string;
  children: ZoneChildStatsDto[];
}
