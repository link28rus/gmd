-- CreateEnum
CREATE TYPE "ZoneEventType" AS ENUM ('entry', 'exit');

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLon" DOUBLE PRECISION NOT NULL,
    "radius" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_child_assignments" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_child_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_events" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "type" "ZoneEventType" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_states" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "isInside" BOOLEAN NOT NULL DEFAULT false,
    "pendingTransition" BOOLEAN NOT NULL DEFAULT false,
    "pendingSince" TIMESTAMP(3),
    "lastConfirmedChange" TIMESTAMP(3),

    CONSTRAINT "zone_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zones_familyId_deletedAt_idx" ON "zones"("familyId", "deletedAt");

-- CreateIndex
CREATE INDEX "zone_child_assignments_childId_idx" ON "zone_child_assignments"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "zone_child_assignments_zoneId_childId_key" ON "zone_child_assignments"("zoneId", "childId");

-- CreateIndex
CREATE INDEX "zone_events_childId_createdAt_idx" ON "zone_events"("childId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "zone_events_zoneId_createdAt_idx" ON "zone_events"("zoneId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "zone_states_childId_idx" ON "zone_states"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "zone_states_zoneId_childId_key" ON "zone_states"("zoneId", "childId");

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_child_assignments" ADD CONSTRAINT "zone_child_assignments_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_child_assignments" ADD CONSTRAINT "zone_child_assignments_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_events" ADD CONSTRAINT "zone_events_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_events" ADD CONSTRAINT "zone_events_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_states" ADD CONSTRAINT "zone_states_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_states" ADD CONSTRAINT "zone_states_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;
