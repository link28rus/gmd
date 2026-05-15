-- v0.51 RuStore Push (lesson #24): добавляем rustorePushToken рядом с fcmToken
-- для child_devices и parent_devices. push.service.ts шлёт через RuStore Push
-- API (vkpns.rustore.ru) если токен есть, иначе fallback на FCM.

-- ChildDevice: rustorePushToken nullable UNIQUE (по аналогии с fcmToken).
ALTER TABLE "child_devices"
    ADD COLUMN "rustorePushToken" TEXT,
    ADD COLUMN "rustorePushTokenUpdatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "child_devices_rustorePushToken_key"
    ON "child_devices"("rustorePushToken");

-- ParentDevice:
--  (1) добавляем rustorePushToken nullable UNIQUE
--  (2) делаем fcmToken nullable — устройство без Google Play Services может
--      зарегистрироваться только через RuStore Push (lesson #24 — основной
--      канал distribution для не-GMS устройств). Backend требует чтобы был
--      хотя бы один из двух (CHECK constraint).
ALTER TABLE "parent_devices"
    ADD COLUMN "rustorePushToken" TEXT,
    ADD COLUMN "rustorePushTokenUpdatedAt" TIMESTAMP(3),
    ALTER COLUMN "fcmToken" DROP NOT NULL;

CREATE UNIQUE INDEX "parent_devices_rustorePushToken_key"
    ON "parent_devices"("rustorePushToken");

ALTER TABLE "parent_devices"
    ADD CONSTRAINT "parent_devices_push_token_present"
    CHECK ("fcmToken" IS NOT NULL OR "rustorePushToken" IS NOT NULL);
