-- v0.60: журнал приложения ребёнка на сервере
-- (docs/superpowers/specs/2026-09-29-child-diag-logs.md).
--  (1) DeviceCommandType + UPLOAD_DIAG — запрос журнала из админки (TTL 24 ч);
--  (2) child_devices.diagConfig — настройки журнала (NULL = умолчания);
--  (3) diag_log_uploads — загруженные журналы (хранение 14 дней / 30 на устройство).
-- ADD VALUE внутри транзакции допустим с PG 12, пока значение не используется
-- в той же транзакции (здесь не используется).

-- AlterEnum
ALTER TYPE "DeviceCommandType" ADD VALUE 'UPLOAD_DIAG';

-- AlterTable
ALTER TABLE "child_devices" ADD COLUMN "diagConfig" JSONB;

-- CreateTable
CREATE TABLE "diag_log_uploads" (
    "id" TEXT NOT NULL,
    "childDeviceId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" TEXT,
    "commandId" TEXT,
    "appVersion" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "snapshot" TEXT,
    "log" TEXT,
    "logcat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diag_log_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diag_log_uploads_childId_createdAt_idx" ON "diag_log_uploads"("childId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "diag_log_uploads_childDeviceId_createdAt_idx" ON "diag_log_uploads"("childDeviceId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "diag_log_uploads" ADD CONSTRAINT "diag_log_uploads_childDeviceId_fkey" FOREIGN KEY ("childDeviceId") REFERENCES "child_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diag_log_uploads" ADD CONSTRAINT "diag_log_uploads_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;
