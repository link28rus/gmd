CREATE TABLE "child_device_permission_states" (
  "childDeviceId" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "permissions" JSONB NOT NULL,
  "lastKnown" JSONB,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "child_device_permission_states_pkey" PRIMARY KEY ("childDeviceId"),
  CONSTRAINT "child_device_permission_states_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "permission_alerts" (
  "id" TEXT NOT NULL,
  "childDeviceId" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "parentDeviceId" TEXT NOT NULL,
  "permissions" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "permission_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "permission_alerts_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "permission_alerts_completedAt_retryAt_idx" ON "permission_alerts"("completedAt", "retryAt");
