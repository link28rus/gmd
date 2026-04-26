-- Phase 6 v0.38: Screen-time reporting (statistics-only, без блокировки).
-- См. docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md
--
-- Создаётся вручную (не через `prisma migrate dev`), потому что shadow DB
-- падает на pg_cron extension — тот же workaround использован для FCM token
-- в 20260426150000_add_fcm_token.

-- ── ChildDevice.timezone ─────────────────────────────────────────────────────
ALTER TABLE "child_devices"
  ADD COLUMN "timezone" TEXT;

-- ── installed_apps ───────────────────────────────────────────────────────────
CREATE TABLE "installed_apps" (
  "id"            TEXT         NOT NULL,
  "childDeviceId" TEXT         NOT NULL,
  "packageName"   TEXT         NOT NULL,
  "appLabel"      TEXT         NOT NULL,
  "iconSha256"    TEXT,
  "isSystem"      BOOLEAN      NOT NULL DEFAULT false,
  "category"      TEXT,
  "firstSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "installed_apps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "installed_apps_childDeviceId_packageName_key"
  ON "installed_apps"("childDeviceId", "packageName");

CREATE INDEX "installed_apps_childDeviceId_idx"
  ON "installed_apps"("childDeviceId");

ALTER TABLE "installed_apps"
  ADD CONSTRAINT "installed_apps_childDeviceId_fkey"
  FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── app_icons (глобальный sha256-dedupe кэш, BYTEA в БД для MVP) ────────────
-- Иконки PNG max 96x96 RGBA, ≤100KB, content-addressable по sha256.
-- Отдаются через GET /app-icons/:sha256 с immutable Cache-Control.
CREATE TABLE "app_icons" (
  "sha256"    TEXT         NOT NULL,
  "pngBytes"  BYTEA        NOT NULL,
  "bytes"     INTEGER      NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_icons_pkey" PRIMARY KEY ("sha256")
);

-- ── usage_buckets (часовые bucket'ы использования) ──────────────────────────
CREATE TABLE "usage_buckets" (
  "id"            TEXT    NOT NULL,
  "childDeviceId" TEXT    NOT NULL,
  "date"          DATE    NOT NULL,
  "hour"          INTEGER NOT NULL,
  "packageName"   TEXT    NOT NULL,
  "seconds"       INTEGER NOT NULL,
  CONSTRAINT "usage_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_buckets_childDeviceId_date_hour_packageName_key"
  ON "usage_buckets"("childDeviceId", "date", "hour", "packageName");

CREATE INDEX "usage_buckets_childDeviceId_date_idx"
  ON "usage_buckets"("childDeviceId", "date");

ALTER TABLE "usage_buckets"
  ADD CONSTRAINT "usage_buckets_childDeviceId_fkey"
  FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── pg_cron job: retention 30 дней для usage_buckets ────────────────────────
-- На prod выполняется в 03:15 по UTC (тихое время для всех TZ).
-- В dev — расширение pg_cron может отсутствовать, поэтому обёрнуто в
-- DO + EXCEPTION WHEN OTHERS, чтобы миграция не падала локально.
DO $$
BEGIN
  PERFORM cron.schedule(
    'gmd_usage_buckets_cleanup',
    '15 3 * * *',
    $cmd$DELETE FROM usage_buckets WHERE date < (CURRENT_DATE - INTERVAL '30 days')$cmd$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available in this environment (%), skipping cleanup job', SQLERRM;
END $$;
