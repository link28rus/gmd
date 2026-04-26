-- v0.37: FCM token для high-priority push доставки команд (мгновенный START_AUDIO).
-- nullable: устройство ещё не зарегистрировало FCM (fresh install / нет Google Play Services)
--   → backend fallback'ится на poll-команду через DeviceCommand queue.
ALTER TABLE "child_devices"
  ADD COLUMN "fcmToken" TEXT,
  ADD COLUMN "fcmTokenUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "child_devices_fcmToken_key" ON "child_devices"("fcmToken");
