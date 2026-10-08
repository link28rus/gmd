-- v0.73.0: «Найти телефон» родителя (docs/superpowers/specs/2026-10-09-find-parent-phone.md).
-- Имя модели и push-токен присылает нативная служба при выгрузке точек;
-- сигнал «позвонить» — одна живая команда на устройство.

-- AlterTable
ALTER TABLE "parent_location_devices"
    ADD COLUMN "deviceName"        TEXT,
    ADD COLUMN "fcmToken"          TEXT,
    ADD COLUMN "signalId"          TEXT,
    ADD COLUMN "signalRequestedAt" TIMESTAMP(3),
    ADD COLUMN "signalAckedAt"     TIMESTAMP(3);
