-- Phase 6.x (v0.48): расписание автоблокировки приложений.
-- См. модель AppBlockSchedule в schema.prisma и docs/superpowers/specs/.
--
-- daysMask: 7-битная маска ISO weekday (1=ПН … 7=ВС, bit i-1).
-- startMin/endMin: минуты с полуночи (0..1439, end exclusive). startMin > endMin
-- = расписание пересекает полночь (22:00 → 08:00).
-- TZ берём из child_devices.timezone (IANA), отдельно не храним.

CREATE TYPE "AppBlockScheduleMode" AS ENUM ('BLOCK_NON_ALLOWED');

CREATE TABLE "app_block_schedules" (
    "id" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "daysMask" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "mode" "AppBlockScheduleMode" NOT NULL DEFAULT 'BLOCK_NON_ALLOWED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_block_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_block_schedules_childDeviceId_enabled_idx" ON "app_block_schedules"("childDeviceId", "enabled");

ALTER TABLE "app_block_schedules" ADD CONSTRAINT "app_block_schedules_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_block_schedules" ADD CONSTRAINT "app_block_schedules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
