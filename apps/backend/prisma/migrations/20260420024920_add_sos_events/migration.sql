/*
  Warnings:

  - You are about to drop the column `geom` on the `locations` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "locations_geom_gist_idx";

-- AlterTable
ALTER TABLE "locations" DROP COLUMN "geom";

-- CreateTable
CREATE TABLE "sos_events" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "serverCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" VARCHAR(500),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sos_events_childId_serverCreatedAt_idx" ON "sos_events"("childId", "serverCreatedAt" DESC);

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
