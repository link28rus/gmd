-- v0.62: «Звук вокруг» — микрофон заблокирован после перезагрузки (Android 14+).
ALTER TYPE "AudioFailureReason" ADD VALUE IF NOT EXISTS 'MIC_BLOCKED';

ALTER TABLE "child_devices" ADD COLUMN "micReady" BOOLEAN,
ADD COLUMN "micReadyAt" TIMESTAMP(3);
