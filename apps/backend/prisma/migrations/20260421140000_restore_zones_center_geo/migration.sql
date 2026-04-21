-- Восстанавливает PostGIS generated column `zones.center_geo` + GIST-индекс,
-- которые prisma migrate автогенерировал на дроп в 20260421125819_device_commands.
-- Причина: Prisma 5 не умеет описать `GENERATED ALWAYS AS … STORED` в schema.prisma,
-- поэтому каждый migrate diff ставит DROP. До v0.19.0 этот DROP вычищался вручную;
-- в 20260421125819 об этом забыли, колонка слетела на проде и zones-запросы
-- начали падать (column z.center_geo does not exist), из-за чего падал и
-- POST /child/locations (он джоинит zones для zone-event detection).
--
-- IF NOT EXISTS — чтобы миграция была идемпотентной: на проде колонку уже
-- восстановили ручным ALTER, на fresh-env она создастся штатно.

ALTER TABLE "zones"
  ADD COLUMN IF NOT EXISTS "center_geo" geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("centerLon", "centerLat"), 4326)::geography) STORED;

CREATE INDEX IF NOT EXISTS "zones_center_geo_gist" ON "zones" USING GIST ("center_geo");
