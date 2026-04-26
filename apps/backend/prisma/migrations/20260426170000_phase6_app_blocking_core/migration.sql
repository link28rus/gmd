-- Phase 6.2 (v0.39): App Blocking Core
-- См. docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md §5.

-- ── enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "AppRuleMode" AS ENUM ('DEFAULT', 'ALWAYS_ALLOWED', 'ALWAYS_BLOCKED');
CREATE TYPE "AppRuleSource" AS ENUM ('PARENT', 'SYSTEM_DEFAULT', 'HARDCODED');
CREATE TYPE "BlockSessionState" AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED');
CREATE TYPE "BlockEndReason" AS ENUM ('PARENT_STOPPED', 'EXPIRED', 'UNLOCK_APPROVED');

-- ── app_rules (per-(child × packageName), whitelist storage) ────────────────
CREATE TABLE "app_rules" (
  "id"            TEXT             NOT NULL,
  "childDeviceId" TEXT             NOT NULL,
  "packageName"   TEXT             NOT NULL,
  "mode"          "AppRuleMode"    NOT NULL,
  "source"        "AppRuleSource"  NOT NULL,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "app_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_rules_childDeviceId_packageName_key"
  ON "app_rules"("childDeviceId", "packageName");

CREATE INDEX "app_rules_childDeviceId_idx"
  ON "app_rules"("childDeviceId");

ALTER TABLE "app_rules"
  ADD CONSTRAINT "app_rules_childDeviceId_fkey"
  FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── block_sessions (активная глобальная блокировка экрана) ──────────────────
-- Per-child максимум одна ACTIVE — валидируется на API уровне (нет partial unique
-- в Prisma, проверяем явно перед INSERT). На auto-expire — UPDATE state=EXPIRED.
CREATE TABLE "block_sessions" (
  "id"              TEXT                NOT NULL,
  "childDeviceId"   TEXT                NOT NULL,
  "createdByUserId" TEXT                NOT NULL,
  "state"           "BlockSessionState" NOT NULL DEFAULT 'ACTIVE',
  "startedAt"       TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt"          TIMESTAMP(3)        NOT NULL,
  "endedAt"         TIMESTAMP(3),
  "endReason"       "BlockEndReason",
  CONSTRAINT "block_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "block_sessions_childDeviceId_state_idx"
  ON "block_sessions"("childDeviceId", "state");

CREATE INDEX "block_sessions_endsAt_idx"
  ON "block_sessions"("endsAt");

ALTER TABLE "block_sessions"
  ADD CONSTRAINT "block_sessions_childDeviceId_fkey"
  FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "block_sessions"
  ADD CONSTRAINT "block_sessions_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── pg_cron: auto-expire BlockSession каждую минуту ─────────────────────────
-- Когда endsAt прошёл, но state=ACTIVE — переводим в EXPIRED. Это страховка
-- если backend OnModuleInit cleanup не отработал (например crash во время
-- транзакции) или если setInterval'ы потерялись после OOM.
-- В dev pg_cron может отсутствовать — wrapped в exception handler.
DO $$
BEGIN
  PERFORM cron.schedule(
    'gmd_block_sessions_auto_expire',
    '* * * * *',
    $cmd$UPDATE block_sessions
         SET state = 'EXPIRED',
             "endedAt" = CURRENT_TIMESTAMP,
             "endReason" = 'EXPIRED'
         WHERE state = 'ACTIVE' AND "endsAt" <= CURRENT_TIMESTAMP$cmd$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available in this environment (%), skipping auto-expire job', SQLERRM;
END $$;
