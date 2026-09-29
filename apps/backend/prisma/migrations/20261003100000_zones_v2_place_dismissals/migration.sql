-- v0.67.0 (геозоны v2, этап 4): скрытые подсказки мест. Колонку
-- zones.center_geo Prisma не видит — её DROP из migrate diff не добавляем.
CREATE TABLE "zone_place_dismissals" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_place_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zone_place_dismissals_familyId_idx" ON "zone_place_dismissals"("familyId");

ALTER TABLE "zone_place_dismissals" ADD CONSTRAINT "zone_place_dismissals_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
