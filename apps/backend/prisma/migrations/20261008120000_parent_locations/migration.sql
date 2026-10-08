-- v0.70.0: геолокация родителей на общей карте семьи.
-- Флаг видимости у пользователя + устройства с долгоживущим токеном + точки.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "shareLocationWithFamily" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "parent_location_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "platform" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "parent_location_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_locations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "batteryLevel" INTEGER,
    "isCharging" BOOLEAN,
    "provider" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parent_location_devices_tokenHash_key" ON "parent_location_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "parent_location_devices_userId_idx" ON "parent_location_devices"("userId");

-- CreateIndex
CREATE INDEX "parent_locations_userId_recordedAt_idx" ON "parent_locations"("userId", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "parent_locations_deviceId_recordedAt_key" ON "parent_locations"("deviceId", "recordedAt");

-- AddForeignKey
ALTER TABLE "parent_location_devices" ADD CONSTRAINT "parent_location_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_locations" ADD CONSTRAINT "parent_locations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_locations" ADD CONSTRAINT "parent_locations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "parent_location_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- pg_cron retention (30 days), как у точек детей. Guarded: extension may be absent in test/dev images.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parent-locations-retention-daily') THEN
      PERFORM cron.unschedule('parent-locations-retention-daily');
    END IF;
    PERFORM cron.schedule(
      'parent-locations-retention-daily',
      '0 3 * * *',
      $SQL$DELETE FROM parent_locations WHERE "recordedAt" < now() - interval '30 days'$SQL$
    );
  END IF;
END $$;
