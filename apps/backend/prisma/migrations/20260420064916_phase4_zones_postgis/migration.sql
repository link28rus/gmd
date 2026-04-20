-- PostGIS generated geography column for zone centers (lon, lat → Point).
-- Enables O(log n) spatial lookups via GIST index for ST_DWithin/ST_Contains
-- in the geofencing evaluator (Phase 4, Tasks 9-11).
ALTER TABLE "zones"
  ADD COLUMN "center_geo" geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("centerLon", "centerLat"), 4326)::geography) STORED;

CREATE INDEX "zones_center_geo_gist" ON "zones" USING GIST ("center_geo");

-- DB-level validation CHECK constraints (belt-and-suspenders with Zod).
ALTER TABLE "zones"
  ADD CONSTRAINT "zones_radius_range" CHECK ("radius" BETWEEN 50 AND 5000),
  ADD CONSTRAINT "zones_lat_range" CHECK ("centerLat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "zones_lon_range" CHECK ("centerLon" BETWEEN -180 AND 180),
  ADD CONSTRAINT "zones_name_length" CHECK (char_length("name") BETWEEN 1 AND 60);

-- pg_cron retention (30 days). Guarded: extension may be absent in test/dev images.
-- NOTE: physical column names are camelCase ("createdAt"/"deletedAt") because schema
-- uses default Prisma naming — must be quoted to avoid Postgres lowercasing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zone-events-retention') THEN
      PERFORM cron.unschedule('zone-events-retention');
    END IF;
    PERFORM cron.schedule(
      'zone-events-retention',
      '0 3 * * *',
      $SQL$DELETE FROM "zone_events" WHERE "createdAt" < now() - interval '30 days'$SQL$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zones-hard-delete') THEN
      PERFORM cron.unschedule('zones-hard-delete');
    END IF;
    PERFORM cron.schedule(
      'zones-hard-delete',
      '15 3 * * *',
      $SQL$DELETE FROM "zones" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < now() - interval '30 days'$SQL$
    );
  END IF;
END $$;
