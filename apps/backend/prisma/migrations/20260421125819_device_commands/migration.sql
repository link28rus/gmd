/*
  Warnings:

  - You are about to drop the column `center_geo` on the `zones` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DeviceCommandType" AS ENUM ('PLAY_SIGNAL');

-- CreateEnum
CREATE TYPE "DeviceCommandStatus" AS ENUM ('pending', 'executed', 'expired', 'cancelled');

-- DropIndex
DROP INDEX "zones_center_geo_gist";

-- AlterTable
ALTER TABLE "zones" DROP COLUMN "center_geo";

-- CreateTable
CREATE TABLE "device_commands" (
    "id" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "type" "DeviceCommandType" NOT NULL,
    "status" "DeviceCommandStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_commands_childDeviceId_status_expiresAt_idx" ON "device_commands"("childDeviceId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
