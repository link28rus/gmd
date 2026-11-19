CREATE TABLE "usage_windows" (
  "childDeviceId" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "segments" JSONB NOT NULL,
  CONSTRAINT "usage_windows_pkey" PRIMARY KEY ("childDeviceId", "startAt"),
  CONSTRAINT "usage_windows_childDeviceId_fkey" FOREIGN KEY ("childDeviceId")
    REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "usage_windows_startAt_idx" ON "usage_windows"("startAt");

DO $$
BEGIN
  PERFORM cron.schedule(
    'gmd_usage_windows_cleanup',
    '20 3 * * *',
    $cmd$DELETE FROM usage_windows WHERE "startAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 days'$cmd$
  );
EXCEPTION
  WHEN undefined_function OR invalid_schema_name THEN
    RAISE NOTICE 'pg_cron not available in this environment, skipping cleanup job';
END $$;
