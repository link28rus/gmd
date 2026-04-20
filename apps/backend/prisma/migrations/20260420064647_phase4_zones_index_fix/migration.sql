/*
  Warnings:

  - Added the required column `updatedAt` to the `zone_states` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "zone_events_childId_createdAt_idx";

-- DropIndex
DROP INDEX "zone_events_zoneId_createdAt_idx";

-- AlterTable
ALTER TABLE "zone_states" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "zone_events_childId_recordedAt_idx" ON "zone_events"("childId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "zone_events_zoneId_recordedAt_idx" ON "zone_events"("zoneId", "recordedAt" DESC);
