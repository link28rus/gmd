-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pointsCount" INTEGER NOT NULL DEFAULT 1,
    "distanceM" INTEGER NOT NULL DEFAULT 0,
    "startLat" DOUBLE PRECISION NOT NULL,
    "startLon" DOUBLE PRECISION NOT NULL,
    "endLat" DOUBLE PRECISION NOT NULL,
    "endLon" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_childId_isActive_idx" ON "trips"("childId", "isActive");

-- CreateIndex
CREATE INDEX "trips_childId_startedAt_idx" ON "trips"("childId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Настройки приложения (key-value). Единая строка на ключ. Админка правит,
-- backend читает с кэшем. Хранит настройки сегментации поездок и пр.
CREATE TABLE "app_settings" (
    "key"         TEXT NOT NULL,
    "value"       TEXT NOT NULL,
    "description" TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "updatedBy"   TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- Дефолты сегментации поездок: 30 мин без движения на 70 метров — конец поездки.
INSERT INTO "app_settings" ("key", "value", "description", "updatedAt") VALUES
  ('trip.idle_minutes', '30', 'Минут без движения, после которых поездка завершается', now()),
  ('trip.idle_radius_m', '70', 'Радиус «остановки» в метрах: если точки в этом радиусе — ребёнок стоит', now());
