-- AlterTable: добавляем тип сети, с которой уходила точка (wifi/mobile/offline).
-- Nullable: старые записи и клиенты без networkType остаются валидны.
ALTER TABLE "locations" ADD COLUMN "networkType" TEXT;
