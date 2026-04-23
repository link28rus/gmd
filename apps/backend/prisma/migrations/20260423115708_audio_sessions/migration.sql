-- CreateEnum
CREATE TYPE "AudioSessionState" AS ENUM ('PENDING', 'READY', 'ACTIVE', 'ENDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AudioFailureReason" AS ENUM ('PERMISSION_DENIED', 'MIC_BUSY', 'OEM_BLOCKED', 'NETWORK_ERROR', 'CHILD_OFFLINE', 'PARENT_TIMEOUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AudioAuditEvent" AS ENUM ('REQUESTED', 'GRANTED', 'STARTED', 'STOPPED', 'FAILED', 'EXPIRED', 'CONSENT_REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceCommandType" ADD VALUE 'START_AUDIO';
ALTER TYPE "DeviceCommandType" ADD VALUE 'STOP_AUDIO';

-- CreateTable
CREATE TABLE "audio_sessions" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "state" "AudioSessionState" NOT NULL DEFAULT 'PENDING',
    "hiddenMode" BOOLEAN NOT NULL DEFAULT true,
    "durationSec" INTEGER NOT NULL,
    "actualSec" INTEGER,
    "failureReason" "AudioFailureReason",
    "sdpOffer" TEXT,
    "sdpAnswer" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "activeAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "billableMinutes" DECIMAL(5,2),
    "costKopecks" INTEGER,

    CONSTRAINT "audio_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_ice_candidates" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "candidate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "audio_ice_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "event" "AudioAuditEvent" NOT NULL,
    "actorUserId" TEXT,
    "actorIp" TEXT,
    "userAgent" VARCHAR(500),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audio_sessions_childId_startedAt_idx" ON "audio_sessions"("childId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "audio_sessions_requestedById_startedAt_idx" ON "audio_sessions"("requestedById", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "audio_sessions_child_active_idx" ON "audio_sessions"("childId", "state");

-- CreateIndex
CREATE INDEX "audio_ice_candidates_sessionId_side_consumed_idx" ON "audio_ice_candidates"("sessionId", "side", "consumed");

-- CreateIndex
CREATE INDEX "audio_audit_log_sessionId_createdAt_idx" ON "audio_audit_log"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "audio_sessions" ADD CONSTRAINT "audio_sessions_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_sessions" ADD CONSTRAINT "audio_sessions_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_sessions" ADD CONSTRAINT "audio_sessions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_ice_candidates" ADD CONSTRAINT "audio_ice_candidates_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "audio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_audit_log" ADD CONSTRAINT "audio_audit_log_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "audio_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
