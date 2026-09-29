-- v0.64.0 (геозоны v2, этап 1).
-- allChildren — зона для всех детей семьи, включая будущих.
-- durationSec — у события выхода: сколько ребёнок пробыл в зоне.
-- Колонку zones.center_geo (generated geography + GIST) Prisma не видит;
-- migrate diff генерирует для неё DROP — здесь его нет намеренно.
ALTER TABLE "zones" ADD COLUMN "allChildren" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "zone_events" ADD COLUMN "durationSec" INTEGER;
