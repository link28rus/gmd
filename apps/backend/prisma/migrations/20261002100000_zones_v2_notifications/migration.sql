-- v0.65.0 (геозоны v2, этап 2): личные настройки уведомлений, расписание зоны,
-- «не пришёл к сроку». Колонку zones.center_geo (generated geography + GIST)
-- Prisma не видит — её DROP из migrate diff вычищен намеренно, как и чужой
-- дрейф FK block_sessions.
ALTER TYPE "ZoneEventType" ADD VALUE 'missed_arrival';
ALTER TYPE "ZoneEventType" ADD VALUE 'no_data';

ALTER TABLE "zones"
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "scheduleDaysMask" INTEGER,
ADD COLUMN     "scheduleStartMin" INTEGER,
ADD COLUMN     "scheduleEndMin" INTEGER,
ADD COLUMN     "arrivalDeadlineMin" INTEGER,
ADD COLUMN     "arrivalDaysMask" INTEGER,
ADD COLUMN     "arrivalGraceMin" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "zone_notification_prefs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "onEntry" BOOLEAN NOT NULL DEFAULT true,
    "onExit" BOOLEAN NOT NULL DEFAULT true,
    "onMissedArrival" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zone_notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_arrival_checks" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "localDate" VARCHAR(10) NOT NULL,
    "verdict" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_arrival_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zone_notification_prefs_zoneId_idx" ON "zone_notification_prefs"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "zone_notification_prefs_userId_zoneId_childId_key" ON "zone_notification_prefs"("userId", "zoneId", "childId");

-- CreateIndex
CREATE UNIQUE INDEX "zone_arrival_checks_zoneId_childId_localDate_key" ON "zone_arrival_checks"("zoneId", "childId", "localDate");

-- AddForeignKey
ALTER TABLE "zone_notification_prefs" ADD CONSTRAINT "zone_notification_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_notification_prefs" ADD CONSTRAINT "zone_notification_prefs_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_notification_prefs" ADD CONSTRAINT "zone_notification_prefs_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_arrival_checks" ADD CONSTRAINT "zone_arrival_checks_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_arrival_checks" ADD CONSTRAINT "zone_arrival_checks_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;
