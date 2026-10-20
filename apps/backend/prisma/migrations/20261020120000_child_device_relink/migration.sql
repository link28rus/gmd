-- v0.85: перепривязка телефона ребёнка с сохранением истории.
ALTER TABLE "invites" ADD COLUMN "replaceDevice" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "child_device_retired_tokens" (
    "tokenHash" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_device_retired_tokens_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX "child_device_retired_tokens_childDeviceId_idx" ON "child_device_retired_tokens"("childDeviceId");

ALTER TABLE "child_device_retired_tokens" ADD CONSTRAINT "child_device_retired_tokens_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
