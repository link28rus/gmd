-- Ensure PostGIS extension is available (geom column below uses geography type).
-- The postgis/postgis Docker image preinstalls binaries; this just registers it in the DB.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "batteryLevel" INTEGER,
    "isCharging" BOOLEAN,
    "provider" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_childId_recordedAt_idx" ON "locations"("childId", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "locations_childDeviceId_recordedAt_key" ON "locations"("childDeviceId", "recordedAt");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PostGIS geometry generated column (lon, lat → Point)
ALTER TABLE "locations"
  ADD COLUMN "geom" geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lon", "lat"), 4326)::geography) STORED;

CREATE INDEX "locations_geom_gist_idx" ON "locations" USING GIST ("geom");

-- pg_cron retention (30 days). Guarded: extension may be absent in test/dev images.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'locations-retention-daily') THEN
      PERFORM cron.unschedule('locations-retention-daily');
    END IF;
    PERFORM cron.schedule(
      'locations-retention-daily',
      '0 3 * * *',
      $SQL$DELETE FROM locations WHERE "recordedAt" < now() - interval '30 days'$SQL$
    );
  END IF;
END $$;
