-- AppSetting.isSecret — включает шифрование value (AES-256-GCM).
-- Используется для SMTP_PASS и потенциально других секретов, которые
-- хранятся в app_settings и редактируются из /admin/settings.
ALTER TABLE "app_settings" ADD COLUMN "isSecret" BOOLEAN NOT NULL DEFAULT false;
