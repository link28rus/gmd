ALTER TABLE "child_devices"
  ADD COLUMN "appControlStatus" JSONB,
  ADD COLUMN "usageReportedAt" TIMESTAMP(3);

-- Старые итоги сохраняются. Новая привязка вносит отдельный накопительный вклад.
ALTER TABLE "usage_buckets" ADD COLUMN "sourceId" TEXT NOT NULL DEFAULT 'legacy';
DROP INDEX "usage_buckets_childDeviceId_date_hour_packageName_key";
CREATE UNIQUE INDEX "usage_buckets_device_source_date_hour_package_key"
  ON "usage_buckets"("childDeviceId", "sourceId", "date", "hour", "packageName");
