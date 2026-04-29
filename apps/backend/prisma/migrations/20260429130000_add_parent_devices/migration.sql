-- v0.46: parent_devices для FCM push на родительские устройства
-- (события geofence enter/exit, SOS, низкий заряд, child offline).

CREATE TABLE "parent_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "fcmTokenUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform" TEXT NOT NULL,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parent_devices_fcmToken_key" ON "parent_devices"("fcmToken");
CREATE INDEX "parent_devices_userId_idx" ON "parent_devices"("userId");

ALTER TABLE "parent_devices" ADD CONSTRAINT "parent_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
