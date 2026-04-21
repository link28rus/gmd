-- AlterTable: имя Wi-Fi сети и оператора мобильной связи для карточки ребёнка.
-- Оба поля nullable — старые клиенты не обязаны присылать.
-- 152-ФЗ: SSID и оператор хранятся не дольше 30 дней вместе с точкой (pg_cron retention).
ALTER TABLE "locations" ADD COLUMN "wifiSsid" TEXT;
ALTER TABLE "locations" ADD COLUMN "mobileOperator" TEXT;
