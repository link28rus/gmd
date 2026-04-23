-- Fix 1: AudioAuditLog.sessionId nullable + SetNull (совместимость с pg_cron retention sessions 90d vs audit 365d)
-- Fix 2: AudioIceSide enum (type-safety вместо String)
-- Fix 3: CHECK durationSec > 0

-- CreateEnum
CREATE TYPE "AudioIceSide" AS ENUM ('parent', 'child');

-- Fix 1: Drop old FK (Restrict), make sessionId nullable, re-add FK (SetNull)
ALTER TABLE "audio_audit_log" DROP CONSTRAINT "audio_audit_log_sessionId_fkey";
ALTER TABLE "audio_audit_log" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "audio_audit_log" ADD CONSTRAINT "audio_audit_log_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "audio_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Fix 2: Replace side text column with AudioIceSide enum
-- Drop existing index that references side
DROP INDEX IF EXISTS "audio_ice_candidates_sessionId_side_consumed_idx";
ALTER TABLE "audio_ice_candidates" DROP COLUMN "side";
ALTER TABLE "audio_ice_candidates" ADD COLUMN "side" "AudioIceSide" NOT NULL DEFAULT 'parent';
ALTER TABLE "audio_ice_candidates" ALTER COLUMN "side" DROP DEFAULT;
CREATE INDEX "audio_ice_candidates_sessionId_side_consumed_idx" ON "audio_ice_candidates"("sessionId", "side", "consumed");

-- Fix 3: CHECK durationSec > 0
ALTER TABLE "audio_sessions" ADD CONSTRAINT "audio_sessions_duration_sec_positive" CHECK ("durationSec" > 0);
