-- v0.50.7: multi-use invites support for RuStore moderator test accounts.
-- maxUses defaults to 1 (one-time invite, prior behavior). usesCount tracks
-- how many times the invite has been claimed; consumedAt is set only when
-- usesCount >= maxUses. Backfill: all existing invites stay maxUses=1 with
-- usesCount=1 if already consumed (or 0 if still active).

ALTER TABLE "invites"
  ADD COLUMN "maxUses" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "usesCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: consumed invites should appear "fully used" so usesCount >= maxUses
-- in case a future migration loosens the consumedAt check. Active invites keep
-- usesCount = 0.
UPDATE "invites" SET "usesCount" = 1 WHERE "consumedAt" IS NOT NULL;
