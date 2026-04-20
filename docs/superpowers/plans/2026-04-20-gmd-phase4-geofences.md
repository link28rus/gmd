# Phase 4 — Геозоны (geofences) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить круговые геозоны с антидребезговой детекцией entry/exit и web-интерфейсом управления в кабинете родителя. В Phase 4 — без уведомлений; события копятся в БД.

**Architecture:** Synchronous zone-detection inside `POST /child/locations` ingest loop (PostGIS `ST_DWithin` + GIST на generated `center_geo`). Debounce 60s + радиус-буфер. Per-family `Zone` с явным `ZoneChildAssignment`. Web-страница `/cabinet/zones` — split (список + карта), редактор — hybrid адрес (Yandex Geocoder server-side proxy) + drag-n-drop. Soft-delete + pg_cron retention 30д.

**Tech Stack:** NestJS + Prisma + PostGIS + pg_cron (backend), Next.js 15 App Router + ymap3-components + shadcn/ui (web). Тесты: Jest unit + supertest e2e + Playwright.

**Spec:** [docs/superpowers/specs/2026-04-20-gmd-phase4-geofences-design.md](../specs/2026-04-20-gmd-phase4-geofences-design.md)

**Ветка:** `feature/phase-4-geofences` от `main`. Целевой релиз: `v0.14.0`.

---

## Файловая карта

### Backend (`apps/backend/`)

**Создать:**

- `src/zones/zones.module.ts`
- `src/zones/zones.controller.ts` — parent REST
- `src/zones/zones.service.ts` — CRUD
- `src/zones/zone-detection.service.ts` — движок проверки, вызывается из ingest
- `src/zones/dto/create-zone.schema.ts` — Zod
- `src/zones/dto/update-zone.schema.ts` — Zod
- `src/zones/dto/zones-events-query.schema.ts` — Zod
- `src/zones/dto/zone.dto.ts` — DTO-тип ответа
- `src/zones/dto/zone-event.dto.ts` — DTO-тип ответа
- `src/zones/zones.service.spec.ts`
- `src/zones/zone-detection.service.spec.ts`
- `src/zones/zones.controller.spec.ts`
- `test/zones.e2e-spec.ts`
- `test/zone-ingest.e2e-spec.ts`
- `prisma/migrations/<timestamp>_phase4_zones/migration.sql`
- `prisma/migrations/<timestamp>_phase4_zones_postgis/migration.sql`

**Изменить:**

- `prisma/schema.prisma` — добавить модели Zone, ZoneChildAssignment, ZoneEvent, ZoneState + enum + relations
- `src/app.module.ts` — зарегистрировать `ZonesModule`
- `src/locations/locations.module.ts` — импорт `ZonesModule`, inject `ZoneDetectionService`
- `src/locations/locations.service.ts` — вызов `ZoneDetectionService.processPoint` внутри транзакции ingest
- `apps/backend/openapi.yaml` (если ведётся) или добавление эндпоинтов в README/api-docs

### Web (`apps/web/`)

**Создать:**

- `app/cabinet/zones/page.tsx`
- `app/cabinet/zones/zones-client.tsx`
- `app/cabinet/zones/components/zones-list.tsx`
- `app/cabinet/zones/components/zones-map.tsx`
- `app/cabinet/zones/components/zone-card.tsx`
- `app/cabinet/zones/components/zone-editor-dialog.tsx`
- `app/cabinet/zones/components/zone-editor-map.tsx`
- `app/cabinet/zones/components/address-search.tsx`
- `app/cabinet/zones/components/color-picker.tsx`
- `app/cabinet/zones/components/icon-picker.tsx`
- `app/cabinet/zones/components/zone-events-feed.tsx`
- `app/api/zones/route.ts`
- `app/api/zones/[id]/route.ts`
- `app/api/zones/events/route.ts`
- `app/api/geocode/route.ts`
- `lib/api/zones.ts`
- `lib/api/geocode.ts`
- `lib/zones/circle-polygon.ts` — turf-style генератор круга из (center, radius)
- `hooks/use-zones.ts`
- `hooks/use-zone-events.ts`
- `tests/unit/zone-editor.test.tsx`
- `tests/unit/zones-list.test.tsx`
- `tests/unit/address-search.test.tsx`
- `tests/unit/circle-polygon.test.ts`
- `tests/e2e/zones-create.spec.ts` (Playwright)

**Изменить:**

- `app/cabinet/layout.tsx` или `cabinet-client.tsx` — добавить пункт «🎯 Геозоны» в sidebar
- `.env.example` + `.env.local.example` — `YANDEX_GEOCODER_API_KEY`

### Инфра и документация

**Изменить:**

- `infra/docker/.env.prod.example` — `YANDEX_GEOCODER_API_KEY`
- `docs/database.md` — ERD + описание таблиц
- `docs/privacy-policy.md` — новый пункт + bump `PRIVACY_POLICY_VERSION`
- `docs/152fz-checklist.md` — запись про zone retention
- `CHANGELOG.md` — запись `v0.14.0`
- `README.md` — геозоны в списке фич

---

## Task 0: Создать feature-ветку

**Files:** —

- [ ] **Step 1: Обновить main и создать ветку**

```bash
cd D:/Project/GMD
git checkout main
git pull origin main
git checkout -b feature/phase-4-geofences
git push -u origin feature/phase-4-geofences
```

Expected: ветка запушена, upstream установлен.

---

## Task 1: Prisma schema — новые модели

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Добавить enum + 4 модели в schema.prisma**

Вставить после модели `SosEvent` (в конец файла):

```prisma
model Zone {
  id        String    @id @default(cuid())
  familyId  String
  name      String    @db.VarChar(60)
  color     String
  icon      String
  centerLat Float
  centerLon Float
  radius    Int
  createdBy String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  family      Family                @relation(fields: [familyId], references: [id], onDelete: Cascade)
  creator     User                  @relation(fields: [createdBy], references: [id], onDelete: Restrict)
  assignments ZoneChildAssignment[]
  events      ZoneEvent[]
  states      ZoneState[]

  @@index([familyId, deletedAt])
  @@map("zones")
}

model ZoneChildAssignment {
  id        String   @id @default(cuid())
  zoneId    String
  childId   String
  createdAt DateTime @default(now())

  zone  Zone  @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  child Child @relation(fields: [childId], references: [id], onDelete: Cascade)

  @@unique([zoneId, childId])
  @@index([childId])
  @@map("zone_child_assignments")
}

enum ZoneEventType {
  entry
  exit
}

model ZoneEvent {
  id         String        @id @default(cuid())
  zoneId     String
  childId    String
  type       ZoneEventType
  lat        Float
  lon        Float
  accuracy   Float?
  recordedAt DateTime
  createdAt  DateTime      @default(now())

  zone  Zone  @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  child Child @relation(fields: [childId], references: [id], onDelete: Cascade)

  @@index([childId, createdAt(sort: Desc)])
  @@index([zoneId, createdAt(sort: Desc)])
  @@map("zone_events")
}

model ZoneState {
  id                  String    @id @default(cuid())
  zoneId              String
  childId             String
  isInside            Boolean   @default(false)
  pendingTransition   Boolean   @default(false)
  pendingSince        DateTime?
  lastConfirmedChange DateTime?

  zone  Zone  @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  child Child @relation(fields: [childId], references: [id], onDelete: Cascade)

  @@unique([zoneId, childId])
  @@index([childId])
  @@map("zone_states")
}
```

- [ ] **Step 2: Добавить обратные relations в существующие модели**

В модели `Family` (после `invites Invite[]`):

```
  zones Zone[]
```

В модели `Child` (после `sosEvents SosEvent[]`):

```
  zoneAssignments ZoneChildAssignment[]
  zoneEvents      ZoneEvent[]
  zoneStates      ZoneState[]
```

В модели `User` (после `consents ConsentRecord[]`):

```
  createdZones Zone[]
```

- [ ] **Step 3: Сгенерировать миграцию**

```bash
cd apps/backend
pnpm prisma migrate dev --name phase4_zones
```

Expected: миграция создана в `prisma/migrations/<timestamp>_phase4_zones/migration.sql`, prisma client регенерирован без ошибок.

- [ ] **Step 4: Smoke test — prisma studio видит таблицы**

```bash
pnpm prisma studio
```

Expected: в левой колонке появились `Zone`, `ZoneChildAssignment`, `ZoneEvent`, `ZoneState`. Можно закрыть.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(backend): Prisma schema — Zone, ZoneChildAssignment, ZoneEvent, ZoneState"
```

---

## Task 2: PostGIS миграция — generated column + GIST + CHECK

**Files:**

- Create: `apps/backend/prisma/migrations/<timestamp>_phase4_zones_postgis/migration.sql`

- [ ] **Step 1: Создать пустую миграцию**

```bash
cd apps/backend
pnpm prisma migrate dev --create-only --name phase4_zones_postgis
```

Expected: создан пустой `migration.sql` в новой папке.

- [ ] **Step 2: Записать SQL**

В `apps/backend/prisma/migrations/<timestamp>_phase4_zones_postgis/migration.sql`:

```sql
-- Generated geography column + GIST index
ALTER TABLE "zones"
  ADD COLUMN "center_geo" geography(Point, 4326)
  GENERATED ALWAYS AS (ST_MakePoint("centerLon", "centerLat")::geography) STORED;

CREATE INDEX "zones_center_geo_gist" ON "zones" USING GIST ("center_geo");

-- Validation CHECK constraints
ALTER TABLE "zones"
  ADD CONSTRAINT "zones_radius_range" CHECK ("radius" BETWEEN 50 AND 5000),
  ADD CONSTRAINT "zones_lat_range" CHECK ("centerLat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "zones_lon_range" CHECK ("centerLon" BETWEEN -180 AND 180),
  ADD CONSTRAINT "zones_name_length" CHECK (char_length("name") BETWEEN 1 AND 60);

-- pg_cron retention (guarded — как в locations)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron' AND installed_version IS NOT NULL) THEN
    PERFORM cron.schedule(
      'zone-events-retention',
      '0 3 * * *',
      $cron$ DELETE FROM zone_events WHERE created_at < now() - interval '30 days'; $cron$
    );
    PERFORM cron.schedule(
      'zones-hard-delete',
      '15 3 * * *',
      $cron$ DELETE FROM zones WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'; $cron$
    );
  END IF;
END
$$;
```

- [ ] **Step 3: Применить миграцию**

```bash
pnpm prisma migrate dev
```

Expected: миграция применена. Если локальный Postgres без PostGIS — выдаст ошибку `geography type does not exist` — это значит dev-инстанс не postgis, поправить инфру (`infra/docker/docker-compose.dev.yml` → `postgis/postgis:16-3.4`).

- [ ] **Step 4: Smoke test — вручную проверить индекс**

```bash
pnpm prisma db execute --stdin <<< "\d+ zones"
```

Expected: колонка `center_geo` с `geography(Point,4326)` видна, индекс `zones_center_geo_gist` указан как GIST.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/migrations/
git commit -m "feat(backend): PostGIS generated center_geo + GIST index + CHECK constraints for zones"
```

---

## Task 3: Zod-схемы для zones DTO

**Files:**

- Create: `apps/backend/src/zones/dto/create-zone.schema.ts`
- Create: `apps/backend/src/zones/dto/update-zone.schema.ts`
- Create: `apps/backend/src/zones/dto/zones-events-query.schema.ts`

- [ ] **Step 1: Константы палитры и иконок**

Создать `apps/backend/src/zones/dto/constants.ts`:

```typescript
export const ZONE_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#64748b',
] as const;

export const ZONE_ICONS = [
  'home',
  'school',
  'sport',
  'art',
  'hospital',
  'shop',
  'music',
  'other',
] as const;

export const MAX_ZONES_PER_FAMILY = 20;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 5000;
```

- [ ] **Step 2: create-zone.schema.ts**

```typescript
import { z } from 'zod';
import { ZONE_COLORS, ZONE_ICONS, MIN_RADIUS_M, MAX_RADIUS_M } from './constants';

export const CreateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: z.enum(ZONE_COLORS),
    icon: z.enum(ZONE_ICONS),
    centerLat: z.number().gte(-90).lte(90),
    centerLon: z.number().gte(-180).lte(180),
    radius: z.number().int().gte(MIN_RADIUS_M).lte(MAX_RADIUS_M),
    childIds: z.array(z.string().cuid()).min(0).default([]),
  })
  .strict();

export type CreateZoneDto = z.infer<typeof CreateZoneSchema>;
```

- [ ] **Step 3: update-zone.schema.ts**

```typescript
import { z } from 'zod';
import { ZONE_COLORS, ZONE_ICONS, MIN_RADIUS_M, MAX_RADIUS_M } from './constants';

export const UpdateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: z.enum(ZONE_COLORS).optional(),
    icon: z.enum(ZONE_ICONS).optional(),
    centerLat: z.number().gte(-90).lte(90).optional(),
    centerLon: z.number().gte(-180).lte(180).optional(),
    radius: z.number().int().gte(MIN_RADIUS_M).lte(MAX_RADIUS_M).optional(),
    childIds: z.array(z.string().cuid()).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type UpdateZoneDto = z.infer<typeof UpdateZoneSchema>;
```

- [ ] **Step 4: zones-events-query.schema.ts**

```typescript
import { z } from 'zod';

export const ZonesEventsQuerySchema = z
  .object({
    childId: z.string().cuid().optional(),
    zoneId: z.string().cuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().datetime().optional(),
    limit: z.coerce.number().int().gte(1).lte(100).default(50),
  })
  .strict();

export type ZonesEventsQuery = z.infer<typeof ZonesEventsQuerySchema>;
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/zones/dto/
git commit -m "feat(backend): Zod-схемы create/update-zone, events-query, palette constants"
```

---

## Task 4: ZonesService — create (с TDD)

**Files:**

- Create: `apps/backend/src/zones/dto/zone.dto.ts`
- Create: `apps/backend/src/zones/zones.service.ts`
- Create: `apps/backend/src/zones/zones.service.spec.ts`

- [ ] **Step 1: Написать zone.dto.ts (тип ответа)**

```typescript
export interface ZoneDto {
  id: string;
  familyId: string;
  name: string;
  color: string;
  icon: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  childIds: string[];
  states?: Array<{ childId: string; isInside: boolean }>;
}
```

- [ ] **Step 2: Написать failing test**

Создать `apps/backend/src/zones/zones.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ZonesService } from './zones.service';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';

const prismaMock = {
  zone: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  zoneChildAssignment: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
  zoneState: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  child: { findMany: jest.fn() },
  $transaction: jest.fn(async (fn: unknown) =>
    typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(prismaMock) : fn,
  ),
};

describe('ZonesService.create', () => {
  let svc: ZonesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('создаёт зону с ZoneChildAssignment и инициализирует ZoneState', async () => {
    prismaMock.zone.count.mockResolvedValue(3);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    prismaMock.zone.create.mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'Школа',
      color: '#22c55e',
      icon: 'school',
      centerLat: 48.48,
      centerLon: 135.08,
      radius: 250,
      createdBy: 'u1',
      createdAt: new Date('2026-04-20T10:00:00Z'),
      updatedAt: new Date('2026-04-20T10:00:00Z'),
    });

    const result = await svc.create('f1', 'u1', {
      name: 'Школа',
      color: '#22c55e',
      icon: 'school',
      centerLat: 48.48,
      centerLon: 135.08,
      radius: 250,
      childIds: ['c1', 'c2'],
    });

    expect(prismaMock.zone.create).toHaveBeenCalled();
    expect(prismaMock.zoneChildAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z1', childId: 'c1' },
        { zoneId: 'z1', childId: 'c2' },
      ],
    });
    expect(prismaMock.zoneState.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z1', childId: 'c1', isInside: false },
        { zoneId: 'z1', childId: 'c2', isInside: false },
      ],
    });
    expect(result.id).toBe('z1');
    expect(result.childIds).toEqual(['c1', 'c2']);
  });

  it('бросает ConflictException при превышении лимита', async () => {
    prismaMock.zone.count.mockResolvedValue(MAX_ZONES_PER_FAMILY);
    await expect(
      svc.create('f1', 'u1', {
        name: 'X',
        color: '#22c55e',
        icon: 'home',
        centerLat: 0,
        centerLon: 0,
        radius: 100,
        childIds: [],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('бросает NotFoundException если childId не из этой семьи', async () => {
    prismaMock.zone.count.mockResolvedValue(0);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }]); // не нашли c2
    await expect(
      svc.create('f1', 'u1', {
        name: 'X',
        color: '#22c55e',
        icon: 'home',
        centerLat: 0,
        centerLon: 0,
        radius: 100,
        childIds: ['c1', 'c2'],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Запустить тесты — должны упасть**

```bash
pnpm --filter @gmd/backend test zones.service.spec
```

Expected: FAIL — `ZonesService` не существует.

- [ ] **Step 4: Реализовать ZonesService.create**

Создать `apps/backend/src/zones/zones.service.ts`:

```typescript
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateZoneDto } from './dto/create-zone.schema';
import type { ZoneDto } from './dto/zone.dto';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';

@Injectable()
export class ZonesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(familyId: string, userId: string, dto: CreateZoneDto): Promise<ZoneDto> {
    const count = await this.prisma.zone.count({
      where: { familyId, deletedAt: null },
    });
    if (count >= MAX_ZONES_PER_FAMILY) {
      throw new ConflictException({
        code: 'zone_limit_reached',
        message: `Family cannot have more than ${MAX_ZONES_PER_FAMILY} zones`,
      });
    }

    if (dto.childIds.length > 0) {
      const children = await this.prisma.child.findMany({
        where: { id: { in: dto.childIds }, familyId, deletedAt: null },
        select: { id: true },
      });
      if (children.length !== dto.childIds.length) {
        throw new NotFoundException({
          code: 'child_not_found',
          message: 'One or more children not found in family',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const zone = await tx.zone.create({
        data: {
          familyId,
          name: dto.name,
          color: dto.color,
          icon: dto.icon,
          centerLat: dto.centerLat,
          centerLon: dto.centerLon,
          radius: dto.radius,
          createdBy: userId,
        },
      });

      if (dto.childIds.length > 0) {
        await tx.zoneChildAssignment.createMany({
          data: dto.childIds.map((childId) => ({ zoneId: zone.id, childId })),
        });
        await tx.zoneState.createMany({
          data: dto.childIds.map((childId) => ({
            zoneId: zone.id,
            childId,
            isInside: false,
          })),
        });
      }

      return this.toDto(zone, dto.childIds);
    });
  }

  private toDto(
    row: {
      id: string;
      familyId: string;
      name: string;
      color: string;
      icon: string;
      centerLat: number;
      centerLon: number;
      radius: number;
      createdBy: string;
      createdAt: Date;
      updatedAt: Date;
    },
    childIds: string[],
  ): ZoneDto {
    return {
      id: row.id,
      familyId: row.familyId,
      name: row.name,
      color: row.color,
      icon: row.icon,
      centerLat: row.centerLat,
      centerLon: row.centerLon,
      radius: row.radius,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      childIds,
    };
  }
}
```

- [ ] **Step 5: Запустить тесты — должны пройти**

```bash
pnpm --filter @gmd/backend test zones.service.spec
```

Expected: 3 тест passed.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/zones/
git commit -m "feat(backend): ZonesService.create с limit check и ZoneState init"
```

---

## Task 5: ZonesService — list, get, update, delete

**Files:**

- Modify: `apps/backend/src/zones/zones.service.ts`
- Modify: `apps/backend/src/zones/zones.service.spec.ts`

- [ ] **Step 1: Написать failing-тесты для list/get/update/delete**

Добавить в `zones.service.spec.ts`:

```typescript
describe('ZonesService.list', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('возвращает зоны семьи с assignments и states', async () => {
    prismaMock.zone.findMany.mockResolvedValue([
      {
        id: 'z1',
        familyId: 'f1',
        name: 'Школа',
        color: '#22c55e',
        icon: 'school',
        centerLat: 48,
        centerLon: 135,
        radius: 250,
        createdBy: 'u1',
        createdAt: new Date('2026-04-20'),
        updatedAt: new Date('2026-04-20'),
        assignments: [{ childId: 'c1' }, { childId: 'c2' }],
        states: [
          { childId: 'c1', isInside: true },
          { childId: 'c2', isInside: false },
        ],
      },
    ]);

    const result = await svc.list('f1');
    expect(result).toHaveLength(1);
    expect(result[0].childIds).toEqual(['c1', 'c2']);
    expect(result[0].states).toEqual([
      { childId: 'c1', isInside: true },
      { childId: 'c2', isInside: false },
    ]);
  });
});

describe('ZonesService.get', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('бросает NotFoundException для чужой семьи (anti-enumeration)', async () => {
    prismaMock.zone.findFirst.mockResolvedValue(null);
    await expect(svc.get('f1', 'z1')).rejects.toThrow(NotFoundException);
  });
});

describe('ZonesService.update', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('обновляет assignments: добавляет новые, удаляет убранные, синхронизирует ZoneState', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'X',
      color: '#22c55e',
      icon: 'home',
      centerLat: 0,
      centerLon: 0,
      radius: 100,
      createdBy: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      assignments: [{ childId: 'c1' }, { childId: 'c2' }],
    });
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c2' }, { id: 'c3' }]);
    prismaMock.zone.update.mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'X',
      color: '#22c55e',
      icon: 'home',
      centerLat: 0,
      centerLon: 0,
      radius: 100,
      createdBy: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await svc.update('f1', 'z1', { childIds: ['c2', 'c3'] });

    expect(prismaMock.zoneChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { in: ['c1'] } },
    });
    expect(prismaMock.zoneState.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { in: ['c1'] } },
    });
    expect(prismaMock.zoneChildAssignment.createMany).toHaveBeenCalledWith({
      data: [{ zoneId: 'z1', childId: 'c3' }],
    });
    expect(prismaMock.zoneState.createMany).toHaveBeenCalledWith({
      data: [{ zoneId: 'z1', childId: 'c3', isInside: false }],
    });
  });
});

describe('ZonesService.softDelete', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('устанавливает deletedAt и не трогает события/состояния', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({ id: 'z1', familyId: 'f1', deletedAt: null });
    prismaMock.zone.update.mockResolvedValue({ id: 'z1', deletedAt: new Date() });

    await svc.softDelete('f1', 'z1');

    expect(prismaMock.zone.update).toHaveBeenCalledWith({
      where: { id: 'z1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prismaMock.zoneState.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тесты — падают**

```bash
pnpm --filter @gmd/backend test zones.service.spec
```

Expected: FAIL на новых методах.

- [ ] **Step 3: Реализовать list/get/update/softDelete в ZonesService**

Добавить в `zones.service.ts`:

```typescript
async list(familyId: string): Promise<ZoneDto[]> {
  const zones = await this.prisma.zone.findMany({
    where: { familyId, deletedAt: null },
    include: {
      assignments: { select: { childId: true } },
      states: { select: { childId: true, isInside: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return zones.map((z) => ({
    ...this.toDto(z, z.assignments.map((a) => a.childId)),
    states: z.states.map((s) => ({ childId: s.childId, isInside: s.isInside })),
  }));
}

async get(familyId: string, zoneId: string): Promise<ZoneDto> {
  const zone = await this.prisma.zone.findFirst({
    where: { id: zoneId, familyId, deletedAt: null },
    include: {
      assignments: { select: { childId: true } },
      states: { select: { childId: true, isInside: true } },
    },
  });
  if (!zone) {
    throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
  }
  return {
    ...this.toDto(zone, zone.assignments.map((a) => a.childId)),
    states: zone.states.map((s) => ({ childId: s.childId, isInside: s.isInside })),
  };
}

async update(
  familyId: string,
  zoneId: string,
  dto: import('./dto/update-zone.schema').UpdateZoneDto,
): Promise<ZoneDto> {
  const zone = await this.prisma.zone.findFirst({
    where: { id: zoneId, familyId, deletedAt: null },
    include: { assignments: { select: { childId: true } } },
  });
  if (!zone) {
    throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
  }

  return this.prisma.$transaction(async (tx) => {
    const scalarData: Record<string, unknown> = {};
    for (const k of ['name', 'color', 'icon', 'centerLat', 'centerLon', 'radius'] as const) {
      if (dto[k] !== undefined) scalarData[k] = dto[k];
    }

    if (dto.childIds !== undefined) {
      if (dto.childIds.length > 0) {
        const children = await tx.child.findMany({
          where: { id: { in: dto.childIds }, familyId, deletedAt: null },
          select: { id: true },
        });
        if (children.length !== dto.childIds.length) {
          throw new NotFoundException({
            code: 'child_not_found',
            message: 'One or more children not found in family',
          });
        }
      }
      const current = new Set(zone.assignments.map((a) => a.childId));
      const next = new Set(dto.childIds);
      const toRemove = [...current].filter((id) => !next.has(id));
      const toAdd = [...next].filter((id) => !current.has(id));

      if (toRemove.length > 0) {
        await tx.zoneChildAssignment.deleteMany({
          where: { zoneId, childId: { in: toRemove } },
        });
        await tx.zoneState.deleteMany({
          where: { zoneId, childId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        await tx.zoneChildAssignment.createMany({
          data: toAdd.map((childId) => ({ zoneId, childId })),
        });
        await tx.zoneState.createMany({
          data: toAdd.map((childId) => ({ zoneId, childId, isInside: false })),
        });
      }
    }

    const updated = await tx.zone.update({
      where: { id: zoneId },
      data: scalarData,
      include: {
        assignments: { select: { childId: true } },
        states: { select: { childId: true, isInside: true } },
      },
    });
    return {
      ...this.toDto(updated, updated.assignments.map((a) => a.childId)),
      states: updated.states.map((s) => ({ childId: s.childId, isInside: s.isInside })),
    };
  });
}

async softDelete(familyId: string, zoneId: string): Promise<void> {
  const zone = await this.prisma.zone.findFirst({
    where: { id: zoneId, familyId, deletedAt: null },
    select: { id: true },
  });
  if (!zone) {
    throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
  }
  await this.prisma.zone.update({
    where: { id: zoneId },
    data: { deletedAt: new Date() },
  });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

```bash
pnpm --filter @gmd/backend test zones.service.spec
```

Expected: все тесты (~7) passed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/zones/
git commit -m "feat(backend): ZonesService list/get/update/softDelete с синхронизацией assignments и ZoneState"
```

---

## Task 6: ZonesService — listEvents (лента)

**Files:**

- Create: `apps/backend/src/zones/dto/zone-event.dto.ts`
- Modify: `apps/backend/src/zones/zones.service.ts`
- Modify: `apps/backend/src/zones/zones.service.spec.ts`

- [ ] **Step 1: zone-event.dto.ts**

```typescript
export interface ZoneEventDto {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  zoneIcon: string;
  childId: string;
  childName: string;
  type: 'entry' | 'exit';
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  createdAt: string;
}
```

- [ ] **Step 2: Failing test**

Добавить в `zones.service.spec.ts`:

```typescript
describe('ZonesService.listEvents', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.zoneEvent = {
      findMany: jest.fn(),
    } as never;
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('возвращает события семьи с pagination cursor', async () => {
    (prismaMock.zoneEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'e1',
        zoneId: 'z1',
        childId: 'c1',
        type: 'entry',
        lat: 48,
        lon: 135,
        accuracy: 10,
        recordedAt: new Date('2026-04-20T10:00:00Z'),
        createdAt: new Date('2026-04-20T10:00:05Z'),
        zone: { name: 'Школа', color: '#22c55e', icon: 'school' },
        child: { name: 'Аня' },
      },
    ]);

    const result = await svc.listEvents('f1', { limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].zoneName).toBe('Школа');
    expect(result.items[0].childName).toBe('Аня');
    expect(result.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 3: Run — fail**

```bash
pnpm --filter @gmd/backend test zones.service.spec
```

- [ ] **Step 4: Реализация listEvents**

Добавить в `zones.service.ts`:

```typescript
async listEvents(
  familyId: string,
  q: import('./dto/zones-events-query.schema').ZonesEventsQuery,
): Promise<{ items: import('./dto/zone-event.dto').ZoneEventDto[]; nextCursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    zone: { familyId },
  };
  if (q.childId) where.childId = q.childId;
  if (q.zoneId) where.zoneId = q.zoneId;
  if (q.from) where.createdAt = { ...(where.createdAt ?? {}), gte: new Date(q.from) };
  if (q.to) where.createdAt = { ...(where.createdAt ?? {}), lte: new Date(q.to) };
  if (q.cursor) where.createdAt = { ...(where.createdAt ?? {}), lt: new Date(q.cursor) };

  const rows = await this.prisma.zoneEvent.findMany({
    where,
    include: {
      zone: { select: { name: true, color: true, icon: true } },
      child: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  });

  const items = rows.map((r) => ({
    id: r.id,
    zoneId: r.zoneId,
    zoneName: r.zone.name,
    zoneColor: r.zone.color,
    zoneIcon: r.zone.icon,
    childId: r.childId,
    childName: r.child.name,
    type: r.type,
    lat: r.lat,
    lon: r.lon,
    accuracy: r.accuracy,
    recordedAt: r.recordedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));

  const nextCursor = rows.length === q.limit ? rows[rows.length - 1].createdAt.toISOString() : null;
  return { items, nextCursor };
}
```

- [ ] **Step 5: Tests pass**

```bash
pnpm --filter @gmd/backend test zones.service.spec
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/zones/
git commit -m "feat(backend): ZonesService.listEvents — лента событий семьи с cursor"
```

---

## Task 7: ZonesController + ZonesModule + регистрация

**Files:**

- Create: `apps/backend/src/zones/zones.controller.ts`
- Create: `apps/backend/src/zones/zones.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: ZonesController**

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ZonesService } from './zones.service';
import { CreateZoneSchema } from './dto/create-zone.schema';
import type { CreateZoneDto } from './dto/create-zone.schema';
import { UpdateZoneSchema } from './dto/update-zone.schema';
import type { UpdateZoneDto } from './dto/update-zone.schema';
import { ZonesEventsQuerySchema } from './dto/zones-events-query.schema';
import type { ZonesEventsQuery } from './dto/zones-events-query.schema';

interface AuthedRequest extends Request {
  user: { userId: string };
}

@Controller('zones')
@UseGuards(JwtAuthGuard)
export class ZonesController {
  constructor(
    @Inject(ZonesService) private readonly svc: ZonesService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async resolveFamilyId(userId: string): Promise<string> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      select: { familyId: true },
    });
    if (!membership) {
      throw new NotFoundException({ code: 'family_not_found', message: 'User has no family' });
    }
    return membership.familyId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateZoneSchema)) dto: CreateZoneDto,
  ) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.create(familyId, req.user.userId, dto);
  }

  @Get()
  async list(@Req() req: AuthedRequest) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.list(familyId);
  }

  @Get('events')
  async events(
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(ZonesEventsQuerySchema)) q: ZonesEventsQuery,
  ) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.listEvents(familyId, q);
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.get(familyId, id);
  }

  @Patch(':id')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateZoneSchema)) dto: UpdateZoneDto,
  ) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.update(familyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async softDelete(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    const familyId = await this.resolveFamilyId(req.user.userId);
    await this.svc.softDelete(familyId, id);
  }
}
```

- [ ] **Step 2: ZonesModule**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
```

- [ ] **Step 3: Зарегистрировать в app.module.ts**

В `apps/backend/src/app.module.ts` добавить в imports:

```typescript
import { ZonesModule } from './zones/zones.module';
// ...
ZonesModule,
```

- [ ] **Step 4: Запустить backend, проверить что не падает**

```bash
pnpm --filter @gmd/backend build
```

Expected: build проходит без TS-ошибок.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/zones/ apps/backend/src/app.module.ts
git commit -m "feat(backend): ZonesController (CRUD + events) + ZonesModule регистрация"
```

---

## Task 8: ZonesController — e2e-тесты

**Files:**

- Create: `apps/backend/test/zones.e2e-spec.ts`

- [ ] **Step 1: Подготовить seed helper**

Проверить `apps/backend/test/fixtures/seed.ts` — там уже есть `signUpParent`. Зоны будет создавать через HTTP, не надо отдельных helper'ов.

- [ ] **Step 2: Написать e2e-тесты**

```typescript
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { signUpParent } from './fixtures/seed';
import { PrismaService } from '../src/prisma/prisma.service';

describe('POST/GET/PATCH/DELETE /zones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zone.deleteMany();
    await prisma.child.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.family.deleteMany();
  });

  const validBody = (overrides = {}) => ({
    name: 'Школа',
    color: '#22c55e',
    icon: 'school',
    centerLat: 48.48,
    centerLon: 135.08,
    radius: 250,
    childIds: [],
    ...overrides,
  });

  it('401 без JWT', async () => {
    await request(app.getHttpServer()).post('/zones').send(validBody()).expect(401);
  });

  it('создаёт зону 201 и возвращает её в GET /zones', async () => {
    const { accessToken } = await signUpParent(app);
    const create = await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(201);
    expect(create.body.id).toBeDefined();
    expect(create.body.name).toBe('Школа');

    const list = await request(app.getHttpServer())
      .get('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(create.body.id);
  });

  it('409 zone_limit_reached при 21-й зоне', async () => {
    const { accessToken } = await signUpParent(app);
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .post('/zones')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody({ name: `Z${i}` }))
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ name: 'Overflow' }))
      .expect(409);
    expect(res.body.code).toBe('zone_limit_reached');
  });

  it('400 при невалидном color', async () => {
    const { accessToken } = await signUpParent(app);
    await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ color: '#fffffe' }))
      .expect(400);
  });

  it('400 при radius < 50', async () => {
    const { accessToken } = await signUpParent(app);
    await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ radius: 10 }))
      .expect(400);
  });

  it('404 при GET чужой зоны', async () => {
    const p1 = await signUpParent(app);
    const p2 = await signUpParent(app, { email: 'other@example.com' });
    const create = await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send(validBody())
      .expect(201);
    await request(app.getHttpServer())
      .get(`/zones/${create.body.id}`)
      .set('Authorization', `Bearer ${p2.accessToken}`)
      .expect(404);
  });

  it('PATCH обновляет name и возвращает обновлённый объект', async () => {
    const { accessToken } = await signUpParent(app);
    const create = await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(201);
    const upd = await request(app.getHttpServer())
      .patch(`/zones/${create.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Новое имя' })
      .expect(200);
    expect(upd.body.name).toBe('Новое имя');
  });

  it('DELETE возвращает 204 и зона исчезает из списка', async () => {
    const { accessToken } = await signUpParent(app);
    const create = await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/zones/${create.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    const list = await request(app.getHttpServer())
      .get('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Запустить e2e-тесты**

```bash
pnpm --filter @gmd/backend test:e2e zones.e2e-spec
```

Expected: все тесты passed. Проверить что `signUpParent` принимает optional override — если нет, адаптировать вызов в тесте.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/test/zones.e2e-spec.ts
git commit -m "test(backend): e2e для /zones CRUD + anti-enumeration + лимит 20"
```

---

## Task 9: ZoneDetectionService — основа (upsert state, find candidates)

**Files:**

- Create: `apps/backend/src/zones/zone-detection.service.ts`
- Create: `apps/backend/src/zones/zone-detection.service.spec.ts`

- [ ] **Step 1: Failing test — findCandidateZones**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ZoneDetectionService } from './zone-detection.service';

const prismaMock = {
  $queryRaw: jest.fn(),
  zoneState: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  zoneEvent: { create: jest.fn() },
};

describe('ZoneDetectionService.findCandidateZones', () => {
  let svc: ZoneDetectionService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZoneDetectionService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZoneDetectionService);
  });

  it('вызывает ST_DWithin с buffer = max(30, radius*0.15) и фильтрует по assignment', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 200 }]);
    const result = await svc.findCandidateZones(prismaMock as never, 'f1', 'c1', 48.48, 135.08);
    expect(result).toEqual([{ id: 'z1', radius: 250, distanceM: 200 }]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — fail (service отсутствует)**

```bash
pnpm --filter @gmd/backend test zone-detection.service.spec
```

- [ ] **Step 3: Реализация findCandidateZones**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ZoneCandidate {
  id: string;
  radius: number;
  distanceM: number;
}

export const DEBOUNCE_MS = 60_000;

function buffer(radius: number): number {
  return Math.max(30, radius * 0.15);
}

@Injectable()
export class ZoneDetectionService {
  private readonly logger = new Logger(ZoneDetectionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findCandidateZones(
    tx: Prisma.TransactionClient | PrismaService,
    familyId: string,
    childId: string,
    lat: number,
    lon: number,
  ): Promise<ZoneCandidate[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; radius: number; distance_m: number }>
    >(Prisma.sql`
      SELECT z.id,
             z.radius,
             ST_Distance(z.center_geo, ST_MakePoint(${lon}, ${lat})::geography) AS distance_m
      FROM zones z
      JOIN zone_child_assignments a ON a."zoneId" = z.id
      WHERE z."familyId" = ${familyId}
        AND a."childId" = ${childId}
        AND z."deletedAt" IS NULL
        AND ST_DWithin(
          z.center_geo,
          ST_MakePoint(${lon}, ${lat})::geography,
          z.radius + GREATEST(30, z.radius * 0.15)
        )
    `);
    return rows.map((r) => ({ id: r.id, radius: r.radius, distanceM: Number(r.distance_m) }));
  }
}
```

- [ ] **Step 4: Tests pass**

```bash
pnpm --filter @gmd/backend test zone-detection.service.spec
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/zones/zone-detection.service.ts apps/backend/src/zones/zone-detection.service.spec.ts
git commit -m "feat(backend): ZoneDetectionService.findCandidateZones с ST_DWithin + buffer"
```

---

## Task 10: ZoneDetectionService — processPoint (debounce + hysteresis)

**Files:**

- Modify: `apps/backend/src/zones/zone-detection.service.ts`
- Modify: `apps/backend/src/zones/zone-detection.service.spec.ts`

- [ ] **Step 1: Failing tests**

Добавить в spec:

```typescript
describe('ZoneDetectionService.processPoint — debounce и hysteresis', () => {
  let svc: ZoneDetectionService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZoneDetectionService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZoneDetectionService);
  });

  const point = {
    familyId: 'f1',
    childId: 'c1',
    deviceId: 'd1',
    lat: 48.48,
    lon: 135.08,
    accuracy: 10,
    recordedAt: new Date('2026-04-20T10:00:00Z'),
  };

  it('первая точка внутри зоны — стартует pendingTransition, события не создаёт', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 100 }]);
    prismaMock.zoneState.findUnique.mockResolvedValue({
      zoneId: 'z1',
      childId: 'c1',
      isInside: false,
      pendingTransition: false,
      pendingSince: null,
    });
    await svc.processPoint(prismaMock as never, point);
    expect(prismaMock.zoneState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          pendingTransition: true,
          pendingSince: point.recordedAt,
        }),
      }),
    );
    expect(prismaMock.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('вторая точка внутри через 65с — создаёт entry-событие', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 100 }]);
    prismaMock.zoneState.findUnique.mockResolvedValue({
      zoneId: 'z1',
      childId: 'c1',
      isInside: false,
      pendingTransition: true,
      pendingSince: new Date('2026-04-20T09:58:55Z'),
    });
    await svc.processPoint(prismaMock as never, point);
    expect(prismaMock.zoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        zoneId: 'z1',
        childId: 'c1',
        type: 'entry',
        lat: 48.48,
        lon: 135.08,
      }),
    });
  });

  it('точка в буфере (exit hysteresis) — сохраняет isInside=true', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'z1', radius: 200, distance_m: 215 }, // в буфере: 200 < 215 < 200+max(30,30)
    ]);
    prismaMock.zoneState.findUnique.mockResolvedValue({
      zoneId: 'z1',
      childId: 'c1',
      isInside: true,
      pendingTransition: false,
      pendingSince: null,
    });
    await svc.processPoint(prismaMock as never, point);
    // candidate == isInside → сброс pending, события нет
    expect(prismaMock.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('ребёнок вне буфера — после debounce exit-событие', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]); // не попал в radius+buffer
    // Но state нам нужен; для exit вне buffer ST_DWithin не попадёт — нужно получить все states для ребёнка
    // Это будет реализовано внутри processPoint: для isInside=true зон, которых не нашли в candidates — тоже надо проверить exit.
    // См. реализацию ниже.
    prismaMock.zoneState.findMany = jest.fn().mockResolvedValue([
      {
        zoneId: 'z1',
        childId: 'c1',
        isInside: true,
        pendingTransition: true,
        pendingSince: new Date('2026-04-20T09:58:55Z'),
      },
    ]);
    await svc.processPoint(prismaMock as never, point);
    expect(prismaMock.zoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        zoneId: 'z1',
        type: 'exit',
      }),
    });
  });
});
```

- [ ] **Step 2: Реализация processPoint**

Добавить в `zone-detection.service.ts`:

```typescript
export interface ProcessPointInput {
  familyId: string;
  childId: string;
  deviceId: string;
  lat: number;
  lon: number;
  accuracy?: number | null;
  recordedAt: Date;
}

// extend class:
async processPoint(
  tx: Prisma.TransactionClient,
  p: ProcessPointInput,
): Promise<void> {
  const candidates = await this.findCandidateZones(tx, p.familyId, p.childId, p.lat, p.lon);

  // Для всех текущих состояний ребёнка, которых нет среди candidates — треат как "вне buffer".
  // Иначе exit никогда не сработает, если точка далеко.
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const existingStates = await tx.zoneState.findMany({
    where: { childId: p.childId, zone: { familyId: p.familyId, deletedAt: null } },
  });

  const allZoneIds = new Set<string>([
    ...candidates.map((c) => c.id),
    ...existingStates.map((s) => s.zoneId),
  ]);

  for (const zoneId of allZoneIds) {
    const cand = candidateMap.get(zoneId);
    const state =
      existingStates.find((s) => s.zoneId === zoneId) ?? {
        zoneId,
        childId: p.childId,
        isInside: false,
        pendingTransition: false,
        pendingSince: null as Date | null,
      };

    let nextCandidate: boolean;
    if (cand) {
      const buf = buffer(cand.radius);
      if (cand.distanceM <= cand.radius) {
        nextCandidate = true;
      } else if (cand.distanceM <= cand.radius + buf) {
        nextCandidate = state.isInside;
      } else {
        nextCandidate = false;
      }
    } else {
      // ребёнок далеко (вне radius+buffer)
      nextCandidate = false;
    }

    if (nextCandidate === state.isInside) {
      if (state.pendingTransition) {
        await tx.zoneState.upsert({
          where: { zoneId_childId: { zoneId, childId: p.childId } },
          create: {
            zoneId,
            childId: p.childId,
            isInside: state.isInside,
            pendingTransition: false,
            pendingSince: null,
          },
          update: { pendingTransition: false, pendingSince: null },
        });
      }
      continue;
    }

    // Кандидат отличается — debounce
    if (!state.pendingTransition) {
      await tx.zoneState.upsert({
        where: { zoneId_childId: { zoneId, childId: p.childId } },
        create: {
          zoneId,
          childId: p.childId,
          isInside: state.isInside,
          pendingTransition: true,
          pendingSince: p.recordedAt,
        },
        update: { pendingTransition: true, pendingSince: p.recordedAt },
      });
      continue;
    }

    const elapsed = p.recordedAt.getTime() - (state.pendingSince?.getTime() ?? 0);
    if (elapsed >= DEBOUNCE_MS) {
      const eventType = nextCandidate ? 'entry' : 'exit';
      await tx.zoneEvent.create({
        data: {
          zoneId,
          childId: p.childId,
          type: eventType,
          lat: p.lat,
          lon: p.lon,
          accuracy: p.accuracy ?? null,
          recordedAt: p.recordedAt,
        },
      });
      await tx.zoneState.upsert({
        where: { zoneId_childId: { zoneId, childId: p.childId } },
        create: {
          zoneId,
          childId: p.childId,
          isInside: nextCandidate,
          pendingTransition: false,
          pendingSince: null,
          lastConfirmedChange: p.recordedAt,
        },
        update: {
          isInside: nextCandidate,
          pendingTransition: false,
          pendingSince: null,
          lastConfirmedChange: p.recordedAt,
        },
      });
      this.logger.log(
        `zone-event ${eventType} child=${p.childId} zone=${zoneId} at=${p.recordedAt.toISOString()}`,
      );
    }
    // иначе: продолжаем ждать, pendingSince не меняем
  }
}
```

- [ ] **Step 3: Tests pass**

```bash
pnpm --filter @gmd/backend test zone-detection.service.spec
```

- [ ] **Step 4: Добавить ZoneDetectionService в ZonesModule exports**

В `zones.module.ts`:

```typescript
import { ZoneDetectionService } from './zone-detection.service';
// ...
providers: [ZonesService, ZoneDetectionService],
exports: [ZonesService, ZoneDetectionService],
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/zones/
git commit -m "feat(backend): ZoneDetectionService.processPoint — debounce 60s + radius buffer"
```

---

## Task 11: Интеграция ZoneDetectionService в LocationsService.ingestBatch

**Files:**

- Modify: `apps/backend/src/locations/locations.module.ts`
- Modify: `apps/backend/src/locations/locations.service.ts`

- [ ] **Step 1: Импортировать ZonesModule**

В `locations.module.ts`:

```typescript
import { ZonesModule } from '../zones/zones.module';
// ...
imports: [PrismaModule, ChildDeviceModule, ConsentModule, AuthModule, ZonesModule],
```

- [ ] **Step 2: Inject ZoneDetectionService в LocationsService**

В `locations.service.ts`:

```typescript
import { ZoneDetectionService } from '../zones/zone-detection.service';
// в constructor добавить:
    @Inject(ZoneDetectionService) private readonly zoneDetection: ZoneDetectionService,
```

- [ ] **Step 3: Переписать ingestBatch с транзакцией + processPoint**

Текущий код делает `$executeRaw` вне транзакции. Переписать на `$transaction`:

```typescript
async ingestBatch(ctx: ChildAuthContext, points: LocationPoint[]): Promise<IngestResult> {
  const child = await this.prisma.child.findUnique({
    where: { id: ctx.childId },
    select: { id: true, familyId: true, deletedAt: true },
  });
  if (!child || child.deletedAt) {
    throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
  }

  const device = await this.prisma.childDevice.findUnique({
    where: { id: ctx.deviceId },
    select: { id: true, revokedAt: true },
  });
  if (!device || device.revokedAt) {
    throw new ForbiddenException({ code: 'device_revoked', message: 'Device revoked' });
  }

  const consentOk = await this.checkOwnerConsent(child.familyId, ctx.childId);
  if (!consentOk) {
    throw new HttpException(
      {
        code: 'consent_required',
        message: 'Owner must accept current privacy policy',
        currentPolicyVersion: this.consent.getCurrentVersion(),
      },
      HttpStatus.LOCKED,
    );
  }

  const rejectedReasons: Record<string, number> = {};
  const now = Date.now();
  const validPoints: LocationPoint[] = [];
  const validRows: Prisma.Sql[] = [];

  for (const p of points) {
    const ts = new Date(p.recordedAt).getTime();
    if (ts < now - OUT_OF_WINDOW_PAST_MS || ts > now + OUT_OF_WINDOW_FUTURE_MS) {
      rejectedReasons.out_of_window = (rejectedReasons.out_of_window ?? 0) + 1;
      continue;
    }
    validPoints.push(p);
    validRows.push(Prisma.sql`(
      ${createId()},
      ${ctx.childId},
      ${ctx.deviceId},
      ${p.lat},
      ${p.lon},
      ${p.accuracy ?? null},
      ${p.altitude ?? null},
      ${p.speed ?? null},
      ${p.bearing ?? null},
      ${p.batteryLevel ?? null},
      ${p.isCharging ?? null},
      ${p.provider ?? null},
      ${new Date(p.recordedAt)}
    )`);
  }

  let accepted = 0;

  if (validRows.length > 0) {
    await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw(Prisma.sql`
        INSERT INTO "locations" (
          "id","childId","childDeviceId","lat","lon","accuracy","altitude","speed","bearing","batteryLevel","isCharging","provider","recordedAt"
        ) VALUES ${Prisma.join(validRows)}
        ON CONFLICT ("childDeviceId","recordedAt") DO NOTHING
      `);
      accepted = Number(inserted);
      const duplicates = validRows.length - accepted;
      if (duplicates > 0) {
        rejectedReasons.duplicate = (rejectedReasons.duplicate ?? 0) + duplicates;
      }

      // Zone detection — только для реально вставленных точек (дубликаты не повторяем).
      // Для простоты и консервативности прогоняем все validPoints; дубликаты просто не изменят state
      // (те же самые точки → те же переходы).
      for (const p of validPoints) {
        await this.zoneDetection.processPoint(tx, {
          familyId: child.familyId,
          childId: ctx.childId,
          deviceId: ctx.deviceId,
          lat: p.lat,
          lon: p.lon,
          accuracy: p.accuracy ?? null,
          recordedAt: new Date(p.recordedAt),
        });
      }
    });
  }

  const rejected = points.length - accepted;
  this.logger.log(
    `ingest child=${ctx.childId} device=${ctx.deviceId} in=${points.length} accepted=${accepted} rejected=${rejected}`,
  );
  return { accepted, rejected, rejectedReasons };
}
```

- [ ] **Step 4: Запустить существующие locations-тесты — не должны регрессировать**

```bash
pnpm --filter @gmd/backend test locations
pnpm --filter @gmd/backend test:e2e locations
```

Expected: все предыдущие тесты passed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/locations/
git commit -m "feat(backend): интеграция ZoneDetectionService в LocationsService.ingestBatch (в транзакции)"
```

---

## Task 12: e2e-тест полного цикла ingest → zone event

**Files:**

- Create: `apps/backend/test/zone-ingest.e2e-spec.ts`

- [ ] **Step 1: Написать e2e с реальным PostGIS**

```typescript
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { signUpParent } from './fixtures/seed';

describe('Ingest → ZoneEvent (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zoneEvent.deleteMany();
    await prisma.zoneState.deleteMany();
    await prisma.zoneChildAssignment.deleteMany();
    await prisma.zone.deleteMany();
    await prisma.location.deleteMany();
    await prisma.childDevice.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.child.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.family.deleteMany();
  });

  it('создаёт entry-событие после 60с устойчивого пребывания внутри', async () => {
    const { accessToken, familyId, userId } = await signUpParent(app);

    // Создать ребёнка и device-token (через invite flow; если в signUpParent нет helper-а — добавить).
    // Для краткости план использует прямые prisma-вставки.
    const child = await prisma.child.create({
      data: { familyId, name: 'Аня' },
    });
    const deviceTokenHash = 'test-device-token-hash';
    const device = await prisma.childDevice.create({
      data: { childId: child.id, tokenHash: deviceTokenHash },
    });

    // Создать зону через API
    const zoneRes = await request(app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Школа',
        color: '#22c55e',
        icon: 'school',
        centerLat: 48.48,
        centerLon: 135.08,
        radius: 250,
        childIds: [child.id],
      })
      .expect(201);

    // Отправить первую точку внутри зоны (в центре)
    const t0 = new Date('2026-04-20T10:00:00Z');
    await request(app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', 'raw-token-that-hashes-to-deviceTokenHash') // см. Note ниже
      .send({
        points: [{ lat: 48.48, lon: 135.08, recordedAt: t0.toISOString() }],
      });

    // После первой точки — pendingTransition=true, событий 0
    const events1 = await prisma.zoneEvent.count();
    expect(events1).toBe(0);

    // Отправить вторую точку через 61 секунду, всё ещё внутри
    const t1 = new Date(t0.getTime() + 61_000);
    await request(app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', 'raw-token-that-hashes-to-deviceTokenHash')
      .send({
        points: [{ lat: 48.48, lon: 135.08, recordedAt: t1.toISOString() }],
      });

    // Теперь должно быть одно entry-событие
    const events2 = await prisma.zoneEvent.findMany();
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe('entry');
  });
});
```

> **Note:** Привязка raw-token к hash — в существующих тестах SOS/locations уже есть паттерн для device-token'а. Использовать тот же helper или прямую вставку hash'а из `argon2.hash(raw, ...)`. Смотреть `test/sos.e2e-spec.ts` как образец.

- [ ] **Step 2: Запустить**

```bash
pnpm --filter @gmd/backend test:e2e zone-ingest
```

Expected: тест passed.

- [ ] **Step 3: Добавить exit-сценарий**

Добавить в тот же describe-блок тест, где после entry отправляется серия точек вне зоны (за buffer'ом) через 60+ секунд → должен появиться exit-event.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/test/zone-ingest.e2e-spec.ts
git commit -m "test(backend): e2e ingest → ZoneEvent (entry после debounce + exit)"
```

---

## Task 13: Next.js proxy routes для /api/zones/\*

**Files:**

- Create: `apps/web/app/api/zones/route.ts`
- Create: `apps/web/app/api/zones/[id]/route.ts`
- Create: `apps/web/app/api/zones/events/route.ts`

- [ ] **Step 1: Посмотреть образец proxy-route**

Прочитать `apps/web/app/api/children/route.ts` — это эталон для всех CRUD proxy.

- [ ] **Step 2: /api/zones/route.ts**

```typescript
import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/api/proxy';

export async function GET(req: NextRequest) {
  return proxyJson(req, '/zones', { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return proxyJson(req, '/zones', { method: 'POST', body });
}
```

- [ ] **Step 3: /api/zones/[id]/route.ts**

```typescript
import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/api/proxy';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyJson(req, `/zones/${id}`, { method: 'GET' });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return proxyJson(req, `/zones/${id}`, { method: 'PATCH', body });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyJson(req, `/zones/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: /api/zones/events/route.ts**

```typescript
import { NextRequest } from 'next/server';
import { proxyJson } from '@/lib/api/proxy';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.search; // пробрасываем query
  return proxyJson(req, `/zones/events${search}`, { method: 'GET' });
}
```

- [ ] **Step 5: Проверить что `proxyJson` уже существует**

```bash
ls apps/web/lib/api/proxy.ts
```

Если нет — найти `lib/api/children.ts` или аналог и посмотреть, как проксируются запросы. Использовать тот же паттерн — не плодить новых абстракций.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/zones/
git commit -m "feat(web): proxy routes /api/zones/* и /api/zones/events"
```

---

## Task 14: /api/geocode proxy route (Yandex Geocoder)

**Files:**

- Create: `apps/web/app/api/geocode/route.ts`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/.env.local.example`

- [ ] **Step 1: Добавить env var**

В `apps/web/.env.example` и `.env.local.example`:

```
YANDEX_GEOCODER_API_KEY=
```

- [ ] **Step 2: /api/geocode/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const YANDEX_GEOCODER_URL = 'https://geocode-maps.yandex.ru/1.x/';

interface YandexResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject: {
          name: string;
          description?: string;
          Point: { pos: string };
        };
      }>;
    };
  };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.YANDEX_GEOCODER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { code: 'geocoder_not_configured', message: 'YANDEX_GEOCODER_API_KEY missing' },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    format: 'json',
    lang: 'ru_RU',
    geocode: q,
    results: '5',
  });

  const res = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    return NextResponse.json(
      { code: 'geocoder_upstream_error', status: res.status },
      { status: 502 },
    );
  }
  const data: YandexResponse = await res.json();
  const items = (data.response?.GeoObjectCollection?.featureMember ?? []).map((m) => {
    const [lon, lat] = m.GeoObject.Point.pos.split(' ').map(Number);
    return {
      name: m.GeoObject.name,
      description: m.GeoObject.description ?? '',
      lat,
      lon,
    };
  });
  return NextResponse.json({ items });
}
```

- [ ] **Step 3: Smoke test**

```bash
cd apps/web && pnpm dev
# в другом терминале:
curl "http://localhost:3000/api/geocode?q=Хабаровск+Ленина+23"
```

Expected (при наличии ключа): `{"items":[...]}`. Без ключа: `{"code":"geocoder_not_configured",...}` 503.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/geocode/ apps/web/.env.example apps/web/.env.local.example
git commit -m "feat(web): server-side proxy /api/geocode для Yandex Geocoder (ключ не в браузере)"
```

---

## Task 15: Web client — lib/api/zones + lib/api/geocode + типы

**Files:**

- Create: `apps/web/lib/api/zones.ts`
- Create: `apps/web/lib/api/geocode.ts`

- [ ] **Step 1: lib/api/zones.ts**

```typescript
export interface ZoneState {
  childId: string;
  isInside: boolean;
}

export interface Zone {
  id: string;
  familyId: string;
  name: string;
  color: string;
  icon: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  childIds: string[];
  states?: ZoneState[];
}

export interface ZoneEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  zoneIcon: string;
  childId: string;
  childName: string;
  type: 'entry' | 'exit';
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  createdAt: string;
}

export interface CreateZoneInput {
  name: string;
  color: string;
  icon: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  childIds: string[];
}

export type UpdateZoneInput = Partial<CreateZoneInput>;

async function jsonOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    throw Object.assign(new Error(`Zones API error: ${res.status}`), {
      status: res.status,
      body,
    });
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function listZones(): Promise<Zone[]> {
  const res = await fetch('/api/zones', { method: 'GET', cache: 'no-store' });
  return (await jsonOrThrow(res)) as Zone[];
}

export async function createZone(input: CreateZoneInput): Promise<Zone> {
  const res = await fetch('/api/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await jsonOrThrow(res)) as Zone;
}

export async function getZone(id: string): Promise<Zone> {
  const res = await fetch(`/api/zones/${id}`, { cache: 'no-store' });
  return (await jsonOrThrow(res)) as Zone;
}

export async function updateZone(id: string, input: UpdateZoneInput): Promise<Zone> {
  const res = await fetch(`/api/zones/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await jsonOrThrow(res)) as Zone;
}

export async function deleteZone(id: string): Promise<void> {
  const res = await fetch(`/api/zones/${id}`, { method: 'DELETE' });
  await jsonOrThrow(res);
}

export interface ListEventsQuery {
  childId?: string;
  zoneId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export async function listEvents(
  q: ListEventsQuery = {},
): Promise<{ items: ZoneEvent[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const url = `/api/zones/events${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  return (await jsonOrThrow(res)) as { items: ZoneEvent[]; nextCursor: string | null };
}
```

- [ ] **Step 2: lib/api/geocode.ts**

```typescript
export interface GeocodeHit {
  name: string;
  description: string;
  lat: number;
  lon: number;
}

const cache = new Map<string, GeocodeHit[]>();

export async function geocode(q: string): Promise<GeocodeHit[]> {
  const key = q.trim().toLowerCase();
  if (!key || key.length < 2) return [];
  if (cache.has(key)) return cache.get(key)!;

  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: GeocodeHit[] };
  const items = data.items ?? [];
  cache.set(key, items);
  return items;
}

export function clearGeocodeCache(): void {
  cache.clear();
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api/zones.ts apps/web/lib/api/geocode.ts
git commit -m "feat(web): typed client lib/api/zones + lib/api/geocode с sessionStorage-cache"
```

---

## Task 16: Web — circle-polygon helper + тесты

**Files:**

- Create: `apps/web/lib/zones/circle-polygon.ts`
- Create: `apps/web/tests/unit/circle-polygon.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { circlePolygon } from '@/lib/zones/circle-polygon';

describe('circlePolygon', () => {
  it('возвращает 64 точки вокруг центра', () => {
    const poly = circlePolygon(48.48, 135.08, 250);
    expect(poly).toHaveLength(65); // 64 точки + замыкающая
    expect(poly[0]).toEqual(poly[poly.length - 1]); // замкнутый
  });

  it('все точки приблизительно на расстоянии radius', () => {
    const poly = circlePolygon(48.48, 135.08, 500);
    // Haversine проверка
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    for (const [lon, lat] of poly.slice(0, -1)) {
      const dLat = toRad(lat - 48.48);
      const dLon = toRad(lon - 135.08);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(48.48)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
      const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      expect(Math.abs(d - 500)).toBeLessThan(5); // < 5м погрешность
    }
  });
});
```

- [ ] **Step 2: Реализация**

```typescript
/**
 * Возвращает замкнутый polygon из 64 точек в формате [lon, lat] (ymap3 convention).
 */
export function circlePolygon(
  lat: number,
  lon: number,
  radiusM: number,
  segments = 64,
): Array<[number, number]> {
  const R = 6371000;
  const angular = radiusM / R;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (i / segments) * 2 * Math.PI;
    const newLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
        Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing),
    );
    const newLonRad =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
        Math.cos(angular) - Math.sin(latRad) * Math.sin(newLatRad),
      );
    points.push([(newLonRad * 180) / Math.PI, (newLatRad * 180) / Math.PI]);
  }
  return points;
}
```

- [ ] **Step 3: Run — pass**

```bash
pnpm --filter @gmd/web test circle-polygon
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/zones/ apps/web/tests/unit/circle-polygon.test.ts
git commit -m "feat(web): circlePolygon helper (64 points, haversine) + unit-тесты"
```

---

## Task 17: Web — страница /cabinet/zones skeleton

**Files:**

- Create: `apps/web/app/cabinet/zones/page.tsx`
- Create: `apps/web/app/cabinet/zones/zones-client.tsx`
- Create: `apps/web/app/cabinet/zones/components/zones-list.tsx`
- Modify: `apps/web/app/cabinet/cabinet-client.tsx` (добавить пункт меню)

- [ ] **Step 1: page.tsx (SSR shell)**

Посмотреть `apps/web/app/cabinet/children/page.tsx` как образец и повторить паттерн — auth guard + pass to client component.

```typescript
import { ZonesClient } from './zones-client';

export default function ZonesPage() {
  return <ZonesClient />;
}
```

- [ ] **Step 2: zones-client.tsx (список + пустое состояние)**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { listZones, Zone } from '@/lib/api/zones';
import { ZonesList } from './components/zones-list';

export function ZonesClient() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listZones()
      .then(setZones)
      .catch((e) => setError(e.message ?? 'Ошибка'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6">Загружаем…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full p-4">
      <div className="lg:w-1/3">
        <ZonesList zones={zones} onChange={setZones} />
      </div>
      <div className="lg:flex-1 bg-muted rounded-md min-h-[400px]">
        {/* zones-map.tsx — добавим в Task 18 */}
        <div className="text-muted-foreground p-4">Карта зон (скоро)</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: components/zones-list.tsx — скелет**

```typescript
'use client';
import { Zone } from '@/lib/api/zones';
import { Button } from '@/components/ui/button';

interface Props {
  zones: Zone[];
  onChange: (z: Zone[]) => void;
}

export function ZonesList({ zones, onChange: _onChange }: Props) {
  if (zones.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground mb-4">
          У вас нет геозон. Создайте первую — например, «Школа» или «Дом».
        </p>
        <Button>+ Новая зона</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Зоны ({zones.length}/20)</h2>
        <Button size="sm">+ Новая</Button>
      </div>
      <ul className="space-y-2">
        {zones.map((z) => (
          <li
            key={z.id}
            className="border rounded-md p-3 flex items-center gap-3"
            style={{ borderLeftWidth: 4, borderLeftColor: z.color }}
          >
            <span className="text-2xl">{iconEmoji(z.icon)}</span>
            <div className="flex-1">
              <div className="font-medium">{z.name}</div>
              <div className="text-xs text-muted-foreground">
                {z.radius} м · {z.childIds.length} реб.
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function iconEmoji(icon: string): string {
  const m: Record<string, string> = {
    home: '🏠',
    school: '🏫',
    sport: '⚽',
    art: '🎨',
    hospital: '🏥',
    shop: '🏪',
    music: '🎵',
    other: '📍',
  };
  return m[icon] ?? '📍';
}
```

- [ ] **Step 4: Добавить пункт в sidebar**

Прочитать `apps/web/app/cabinet/cabinet-client.tsx` и добавить link `/cabinet/zones` рядом с существующими пунктами.

- [ ] **Step 5: Smoke test в браузере**

```bash
pnpm dev
# Открыть http://localhost:3000/cabinet/zones → увидеть пустое состояние
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/cabinet/zones/ apps/web/app/cabinet/cabinet-client.tsx
git commit -m "feat(web): страница /cabinet/zones skeleton — list + empty state + sidebar link"
```

---

## Task 18: Web — карта всех зон (zones-map.tsx)

**Files:**

- Create: `apps/web/app/cabinet/zones/components/zones-map.tsx`
- Modify: `apps/web/app/cabinet/zones/zones-client.tsx`

- [ ] **Step 1: zones-map.tsx**

Посмотреть паттерн `apps/web/components/locations/child-map-inner.tsx` — использовать его подходы для YMap.

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapFeature } from 'ymap3-components';
import { Zone } from '@/lib/api/zones';
import { circlePolygon } from '@/lib/zones/circle-polygon';

interface Props {
  zones: Zone[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

export function ZonesMap({ zones, selectedId, onSelect }: Props) {
  const center: [number, number] =
    zones.length > 0 ? [zones[0].centerLon, zones[0].centerLat] : [135.08, 48.48]; // Хабаровск fallback

  return (
    <YMap location={{ center, zoom: 12 }}>
      <YMapDefaultSchemeLayer />
      <YMapDefaultFeaturesLayer />
      {zones.map((z) => (
        <YMapFeature
          key={z.id}
          geometry={{ type: 'Polygon', coordinates: [circlePolygon(z.centerLat, z.centerLon, z.radius)] }}
          style={{
            fill: z.color,
            fillOpacity: selectedId === z.id ? 0.35 : 0.2,
            stroke: [{ color: z.color, width: selectedId === z.id ? 3 : 2 }],
          }}
          onClick={() => onSelect?.(z.id)}
        />
      ))}
    </YMap>
  );
}
```

- [ ] **Step 2: Интегрировать в zones-client.tsx**

Заменить заглушку «Карта зон (скоро)» на `<ZonesMap zones={zones} selectedId={selected} onSelect={setSelected} />` + state `const [selected, setSelected] = useState<string | null>(null)`.

- [ ] **Step 3: Smoke test**

Создать пару зон через Postman/curl прямо в БД (или ручное сохранение через форму в Task 20), открыть страницу — увидеть круги на карте.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/cabinet/zones/
git commit -m "feat(web): ZonesMap — все круги семьи на Яндекс-карте с выделением"
```

---

## Task 19: Web — color-picker + icon-picker

**Files:**

- Create: `apps/web/app/cabinet/zones/components/color-picker.tsx`
- Create: `apps/web/app/cabinet/zones/components/icon-picker.tsx`

- [ ] **Step 1: color-picker.tsx**

```typescript
'use client';

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#64748b'] as const;

interface Props {
  value: string;
  onChange: (c: string) => void;
}

export function ColorPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Цвет зоны">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Цвет ${c}`}
          onClick={() => onChange(c)}
          className={`w-8 h-8 rounded-full border-2 transition ${
            value === c ? 'border-foreground scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: icon-picker.tsx**

```typescript
'use client';

const ICONS = [
  { id: 'home', emoji: '🏠', label: 'Дом' },
  { id: 'school', emoji: '🏫', label: 'Школа' },
  { id: 'sport', emoji: '⚽', label: 'Спорт' },
  { id: 'art', emoji: '🎨', label: 'Творчество' },
  { id: 'hospital', emoji: '🏥', label: 'Больница' },
  { id: 'shop', emoji: '🏪', label: 'Магазин' },
  { id: 'music', emoji: '🎵', label: 'Музыка' },
  { id: 'other', emoji: '📍', label: 'Другое' },
] as const;

interface Props {
  value: string;
  onChange: (icon: string) => void;
}

export function IconPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Иконка зоны">
      {ICONS.map((i) => (
        <button
          key={i.id}
          type="button"
          role="radio"
          aria-checked={value === i.id}
          aria-label={i.label}
          onClick={() => onChange(i.id)}
          className={`p-2 rounded-md border-2 text-2xl transition ${
            value === i.id ? 'border-primary bg-accent' : 'border-muted'
          }`}
        >
          {i.emoji}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/cabinet/zones/components/
git commit -m "feat(web): ColorPicker + IconPicker с a11y (role=radio, aria-checked)"
```

---

## Task 20: Web — AddressSearch (debounced Geocoder)

**Files:**

- Create: `apps/web/app/cabinet/zones/components/address-search.tsx`
- Create: `apps/web/tests/unit/address-search.test.tsx`

- [ ] **Step 1: address-search.tsx**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { geocode, GeocodeHit } from '@/lib/api/geocode';
import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (q: string) => void;
  onPick: (hit: GeocodeHit) => void;
}

export function AddressSearch({ value, onChange, onPick }: Props) {
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      geocode(value).then((items) => {
        setHits(items);
        setOpen(items.length > 0);
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [value]);

  return (
    <div className="relative">
      <Input
        placeholder="🔍 Адрес"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow max-h-48 overflow-auto">
          {hits.map((h, i) => (
            <li
              key={i}
              className="px-3 py-2 hover:bg-accent cursor-pointer text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(h);
                setOpen(false);
                onChange(h.name);
              }}
            >
              <div className="font-medium">{h.name}</div>
              {h.description && (
                <div className="text-xs text-muted-foreground">{h.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: address-search.test.tsx**

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddressSearch } from '@/app/cabinet/zones/components/address-search';

jest.mock('@/lib/api/geocode', () => ({
  geocode: jest.fn().mockResolvedValue([
    { name: 'Хабаровск, Ленина 23', description: 'Хабаровский край', lat: 48.48, lon: 135.08 },
  ]),
}));

describe('AddressSearch', () => {
  it('показывает подсказки после ввода и вызывает onPick', async () => {
    const onPick = jest.fn();
    render(<AddressSearch value="" onChange={() => {}} onPick={onPick} />);
    // re-render с новым value — через обёртку:
    const { rerender } = render(
      <AddressSearch value="Хабаровск" onChange={() => {}} onPick={onPick} />,
    );
    await waitFor(() =>
      expect(screen.getAllByText(/Хабаровск, Ленина 23/)[0]).toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getAllByText(/Хабаровск, Ленина 23/)[0]);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 48.48, lon: 135.08 }),
    );
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @gmd/web test address-search
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/cabinet/zones/components/address-search.tsx apps/web/tests/unit/address-search.test.tsx
git commit -m "feat(web): AddressSearch с debounce 400мс и dropdown"
```

---

## Task 21: Web — ZoneEditorMap (draggable center + radius handle)

**Files:**

- Create: `apps/web/app/cabinet/zones/components/zone-editor-map.tsx`

- [ ] **Step 1: Реализация**

```typescript
'use client';

import { useState } from 'react';
import {
  YMap,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapFeature,
  YMapMarker,
} from 'ymap3-components';
import { circlePolygon } from '@/lib/zones/circle-polygon';

interface Props {
  centerLat: number;
  centerLon: number;
  radius: number;
  color: string;
  onCenterChange: (lat: number, lon: number) => void;
  onRadiusChange: (m: number) => void;
}

export function ZoneEditorMap({
  centerLat,
  centerLon,
  radius,
  color,
  onCenterChange,
  onRadiusChange,
}: Props) {
  const center: [number, number] = [centerLon, centerLat];

  // Handle-точка на восточной границе круга
  const handleLon = centerLon + radiusToLonDelta(radius, centerLat);
  const handleLat = centerLat;

  return (
    <div className="h-[400px] rounded-md overflow-hidden">
      <YMap location={{ center, zoom: 15 }}>
        <YMapDefaultSchemeLayer />
        <YMapDefaultFeaturesLayer />
        <YMapFeature
          geometry={{
            type: 'Polygon',
            coordinates: [circlePolygon(centerLat, centerLon, radius)],
          }}
          style={{
            fill: color,
            fillOpacity: 0.2,
            stroke: [{ color, width: 2 }],
          }}
        />
        <YMapMarker
          coordinates={center}
          draggable
          onDragEnd={(coords: [number, number]) => {
            onCenterChange(coords[1], coords[0]);
          }}
        >
          <div className="w-4 h-4 rounded-full bg-white border-2" style={{ borderColor: color }} />
        </YMapMarker>
        <YMapMarker
          coordinates={[handleLon, handleLat]}
          draggable
          onDragEnd={(coords: [number, number]) => {
            const newRadius = Math.round(
              haversineM(centerLat, centerLon, coords[1], coords[0]),
            );
            onRadiusChange(Math.max(50, Math.min(5000, newRadius)));
          }}
        >
          <div className="w-3 h-3 rounded-full bg-white border-2" style={{ borderColor: color, cursor: 'ew-resize' }} />
        </YMapMarker>
      </YMap>
    </div>
  );
}

function radiusToLonDelta(m: number, lat: number): number {
  // 1° долготы ≈ 111320 * cos(lat) метров
  return m / (111320 * Math.cos((lat * Math.PI) / 180));
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

- [ ] **Step 2: Smoke test**

Визуально: `pnpm dev`, открыть позже в составе editor-dialog (Task 22).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/cabinet/zones/components/zone-editor-map.tsx
git commit -m "feat(web): ZoneEditorMap — draggable центр и radius-handle"
```

---

## Task 22: Web — ZoneEditorDialog (сборка формы)

**Files:**

- Create: `apps/web/app/cabinet/zones/components/zone-editor-dialog.tsx`
- Create: `apps/web/tests/unit/zone-editor.test.tsx`
- Modify: `apps/web/app/cabinet/zones/zones-client.tsx` (интегрировать кнопку «+ Новая»)

- [ ] **Step 1: ZoneEditorDialog.tsx**

```typescript
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ColorPicker } from './color-picker';
import { IconPicker } from './icon-picker';
import { AddressSearch } from './address-search';
import { ZoneEditorMap } from './zone-editor-map';
import { createZone, updateZone, Zone } from '@/lib/api/zones';
import { toast } from 'sonner';

interface Child {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: Child[];
  initial?: Zone;
  onSaved: (z: Zone) => void;
}

export function ZoneEditorDialog({ open, onOpenChange, children, initial, onSaved }: Props) {
  const [address, setAddress] = useState(initial?.name ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? '#22c55e');
  const [icon, setIcon] = useState(initial?.icon ?? 'home');
  const [centerLat, setCenterLat] = useState(initial?.centerLat ?? 48.48);
  const [centerLon, setCenterLon] = useState(initial?.centerLon ?? 135.08);
  const [radius, setRadius] = useState(initial?.radius ?? 250);
  const [childIds, setChildIds] = useState<string[]>(
    initial?.childIds ?? children.map((c) => c.id),
  );
  const [saving, setSaving] = useState(false);

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('Укажите имя зоны');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), color, icon, centerLat, centerLon, radius, childIds };
      const saved = initial
        ? await updateZone(initial.id, payload)
        : await createZone(payload);
      toast.success(initial ? 'Зона обновлена' : 'Зона создана');
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      const msg = (e as { body?: { message?: string } }).body?.message ?? 'Ошибка сохранения';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Изменить зону' : 'Новая зона'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <AddressSearch
            value={address}
            onChange={setAddress}
            onPick={(h) => {
              setCenterLat(h.lat);
              setCenterLon(h.lon);
              if (!name) setName(h.name.split(',')[0]);
            }}
          />

          <ZoneEditorMap
            centerLat={centerLat}
            centerLon={centerLon}
            radius={radius}
            color={color}
            onCenterChange={(lat, lon) => {
              setCenterLat(lat);
              setCenterLon(lon);
            }}
            onRadiusChange={setRadius}
          />

          <div className="text-sm text-muted-foreground">Радиус: {radius} м</div>

          <div>
            <Label htmlFor="zone-name">Название</Label>
            <Input
              id="zone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div>
            <Label>Цвет</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <div>
            <Label>Иконка</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>

          <div>
            <Label>Дети</Label>
            <div className="space-y-1">
              {children.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={childIds.includes(c.id)}
                    onCheckedChange={(v) => {
                      setChildIds((prev) =>
                        v ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      );
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: zone-editor.test.tsx**

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ZoneEditorDialog } from '@/app/cabinet/zones/components/zone-editor-dialog';

jest.mock('@/lib/api/zones', () => ({
  createZone: jest.fn().mockResolvedValue({ id: 'z1', name: 'Школа' }),
  updateZone: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('ymap3-components', () => ({
  YMap: ({ children }: { children: unknown }) => <div data-testid="ymap">{children as never}</div>,
  YMapDefaultSchemeLayer: () => null,
  YMapDefaultFeaturesLayer: () => null,
  YMapFeature: () => null,
  YMapMarker: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}));
jest.mock('@/lib/api/geocode', () => ({ geocode: jest.fn().mockResolvedValue([]) }));

describe('ZoneEditorDialog', () => {
  it('ошибка если имя пустое', async () => {
    const onSaved = jest.fn();
    render(
      <ZoneEditorDialog open children={[{ id: 'c1', name: 'Аня' }]} onOpenChange={() => {}} onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  });

  it('сохраняет при валидных данных', async () => {
    const onSaved = jest.fn();
    render(
      <ZoneEditorDialog open children={[{ id: 'c1', name: 'Аня' }]} onOpenChange={() => {}} onSaved={onSaved} />,
    );
    const nameInput = screen.getByLabelText('Название');
    fireEvent.change(nameInput, { target: { value: 'Школа' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'z1' })));
  });
});
```

- [ ] **Step 3: Интегрировать в zones-client.tsx**

Добавить state `const [editorOpen, setEditorOpen] = useState(false)` и кнопки «+ Новая» открывающие диалог. После `onSaved` — обновлять `zones`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @gmd/web test zone-editor
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/cabinet/zones/ apps/web/tests/unit/zone-editor.test.tsx
git commit -m "feat(web): ZoneEditorDialog — форма создания/редактирования зоны (адрес + drag + метаданные)"
```

---

## Task 23: Web — Playwright e2e «создать зону через UI»

**Files:**

- Create: `apps/web/tests/e2e/zones-create.spec.ts`

- [ ] **Step 1: Сценарий**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Zones creation', () => {
  test.beforeEach(async ({ page }) => {
    // Логин через известного родителя (если в проекте есть test-login helper — использовать)
    // Иначе — OTP-flow через UI.
    await page.goto('/login');
    // ...
  });

  test('Создать зону → увидеть в списке', async ({ page }) => {
    await page.goto('/cabinet/zones');
    await expect(page.getByText(/У вас нет геозон|Зоны \(/)).toBeVisible();
    await page
      .getByRole('button', { name: /\+ Новая/ })
      .first()
      .click();

    await page.getByLabel('Название').fill('Школа');
    // Цвет — кликаем первый
    await page.locator('[role="radiogroup"][aria-label="Цвет зоны"] button').first().click();
    // Иконка — школа
    await page.getByLabel('Школа').click();

    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Школа')).toBeVisible();
  });
});
```

> **Note:** Существующие Playwright e2e в `apps/web/tests/e2e/` — использовать их setup/fixtures для логина. Если такого нет — добавить ссылку на существующий паттерн из Phase 1.3.

- [ ] **Step 2: Run**

```bash
pnpm --filter @gmd/web test:e2e zones-create
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/zones-create.spec.ts
git commit -m "test(web): Playwright e2e — создание зоны через UI"
```

---

## Task 24: Web — лента событий (zone-events-feed.tsx + hook)

**Files:**

- Create: `apps/web/hooks/use-zone-events.ts`
- Create: `apps/web/app/cabinet/zones/components/zone-events-feed.tsx`

- [ ] **Step 1: use-zone-events.ts (polling 30с, visibility-aware)**

Посмотреть `apps/web/hooks/use-latest-location.ts` как паттерн.

```typescript
'use client';

import { useEffect, useState } from 'react';
import { listEvents, ZoneEvent, ListEventsQuery } from '@/lib/api/zones';

export function useZoneEvents(q: ListEventsQuery = {}) {
  const [events, setEvents] = useState<ZoneEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchLoop = async () => {
      if (cancelled) return;
      try {
        const res = await listEvents(q);
        if (!cancelled) setEvents(res.items);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled && document.visibilityState === 'visible') {
        timer = setTimeout(fetchLoop, 30_000);
      }
    };
    fetchLoop();

    const onVis = () => {
      if (document.visibilityState === 'visible') fetchLoop();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(q)]);

  return { events, loading, error };
}
```

- [ ] **Step 2: zone-events-feed.tsx**

```typescript
'use client';

import { useZoneEvents } from '@/hooks/use-zone-events';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

const ICON_EMOJI: Record<string, string> = {
  home: '🏠',
  school: '🏫',
  sport: '⚽',
  art: '🎨',
  hospital: '🏥',
  shop: '🏪',
  music: '🎵',
  other: '📍',
};

export function ZoneEventsFeed() {
  const { events, loading, error } = useZoneEvents({ limit: 50 });

  if (loading) return <div>Загружаем…</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (events.length === 0) {
    return (
      <div className="text-muted-foreground text-center py-8">
        Событий пока нет — зоны активируются при следующей точке от устройства ребёнка.
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {events.map((e) => (
        <li key={e.id} className="py-2 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {format(new Date(e.createdAt), 'HH:mm', { locale: ru })}
          </span>
          <span className="text-lg">{ICON_EMOJI[e.zoneIcon] ?? '📍'}</span>
          <span>
            <strong>{e.childName}</strong>{' '}
            {e.type === 'entry' ? 'вошла в' : 'вышла из'}{' '}
            <span style={{ color: e.zoneColor }}>«{e.zoneName}»</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Добавить вкладку/секцию в zones-client.tsx**

Добавить tabs или отдельный блок внизу страницы с `<ZoneEventsFeed />`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/cabinet/zones/components/zone-events-feed.tsx apps/web/hooks/use-zone-events.ts
git commit -m "feat(web): ZoneEventsFeed + useZoneEvents (polling 30с, visibility-aware)"
```

---

## Task 25: Документация (database, privacy, 152fz, readme)

**Files:**

- Modify: `docs/database.md`
- Modify: `docs/privacy-policy.md`
- Modify: `docs/152fz-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: docs/database.md**

Добавить раздел «Zones» с описанием 4 таблиц, их связями, индексами и полем `center_geo`. Обновить ERD (если есть визуализация — использовать текстовый ASCII или вставить mermaid).

- [ ] **Step 2: docs/privacy-policy.md**

Добавить пункт в раздел «Какие данные мы собираем»:

> **Геозоны.** Вы можете создать круговые геозоны (например, «Школа», «Дом») и назначать их детям. Мы храним центр зоны (координаты), радиус, имя, цвет и иконку, а также автоматически записываем события входа и выхода вашего ребёнка из этих зон. Срок хранения событий — 30 дней; после этого они автоматически удаляются. Удаление зоны инициирует удаление всей связанной истории в течение 30 дней.

Затем bump `PRIVACY_POLICY_VERSION` в `apps/backend/src/consent/consent.service.ts` (или где он хранится — смотреть как делалось в предыдущих фазах).

- [ ] **Step 3: docs/152fz-checklist.md**

Добавить строку:

> - ✅ **Zones / ZoneEvent / ZoneState** — хранение в РФ, CASCADE при удалении Child/Family, retention 30 дней через pg_cron, soft-delete Zone с hard-delete через 30 дней.

- [ ] **Step 4: README.md**

В разделе «Возможности MVP» добавить:

> - **Геозоны** — круговые зоны (дом, школа, кружки) с автоматической детекцией входа/выхода и лентой событий в кабинете родителя.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md apps/backend/src/consent/
git commit -m "docs: геозоны в database.md, privacy-policy (+bump), 152fz, README"
```

---

## Task 26: CHANGELOG v0.14.0

**Files:**

- Modify: `CHANGELOG.md`

- [ ] **Step 1: Добавить запись**

В верхней части (сразу под `## [Unreleased]` или переместив Unreleased-содержимое):

```markdown
## v0.14.0 — 2026-04-XX

### Новые возможности

- **Геозоны** — создайте круговую зону на карте (дом, школа, кружок), назначьте детей, и кабинет автоматически запишет, когда ребёнок зашёл или вышел. До 20 зон на семью. Уведомления появятся в мобильном приложении (скоро)
- **Карта всех зон и текущее положение детей** — на странице «Геозоны» сразу видно, где сейчас каждый ребёнок относительно ваших зон

### Улучшения

- **Защита от GPS-дрожи** — события «вошёл/вышел» срабатывают только после 60 секунд устойчивого состояния, плюс буферная зона 15% радиуса при выходе — без ложных срабатываний при прогулках у границы

### Изменения

- feat(backend): таблицы `zones`, `zone_child_assignments`, `zone_events`, `zone_states` + generated `center_geo geography` + GIST-индекс
- feat(backend): синхронная проверка зон в `POST /child/locations` (PostGIS `ST_DWithin`)
- feat(backend): REST `/zones/*` — CRUD + `/zones/events` лента
- feat(web): страница `/cabinet/zones` с Яндекс-картой, редактором (адрес + drag) и лентой событий
- feat(web): proxy-роуты `/api/zones/*` + client `lib/api/zones`
- feat(web): server-side proxy `/api/geocode` для Yandex Geocoder (ключ не в браузере)
- chore(infra): pg_cron-задачи `zone-events-retention` (30д) и `zones-hard-delete` (30д после soft-delete)
- chore(privacy): bump `PRIVACY_POLICY_VERSION`, новый пункт про обработку геозон
```

Когда будет финальный commit / tag — заменить `2026-04-XX` на реальную дату.

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG v0.14.0 — геозоны"
```

---

## Task 27: Verification, PR и деплой

**Files:** —

- [ ] **Step 1: Полный test-run (backend)**

```bash
pnpm --filter @gmd/backend lint
pnpm --filter @gmd/backend typecheck
pnpm --filter @gmd/backend test
pnpm --filter @gmd/backend test:e2e
```

Expected: 0 ошибок, все тесты passed.

- [ ] **Step 2: Полный test-run (web)**

```bash
pnpm --filter @gmd/web lint
pnpm --filter @gmd/web typecheck
pnpm --filter @gmd/web test
pnpm --filter @gmd/web test:e2e
```

Expected: 0 ошибок.

- [ ] **Step 3: Локальный smoke (против дев-стека)**

```bash
pnpm stack:up
pnpm dev
```

Вручную:

1. Залогиниться в `/cabinet` через OTP.
2. Открыть `/cabinet/zones` → создать тестовую зону «Школа» через адрес.
3. Через Postman/curl послать `POST /child/locations` (внутри зоны, разных timestamp'ов). Нужен валидный X-Child-Token — взять из invite-flow или db.
4. Через 60+ секунд — увидеть entry в ленте.
5. Послать точку далеко от зоны, через 60с — exit в ленте.
6. Отредактировать зону (поменять имя/радиус) → увидеть обновление.
7. Удалить зону → исчезла из списка, но события остались.

- [ ] **Step 4: Обновить дату в CHANGELOG**

Заменить `2026-04-XX` в `CHANGELOG.md` на текущую дату. Commit:

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG release date v0.14.0"
```

- [ ] **Step 5: Push и создать PR**

```bash
git push origin feature/phase-4-geofences
gh pr create --title "Phase 4: Geofences (v0.14.0)" --body "$(cat <<'EOF'
## Summary

- Круговые геозоны (до 20/семья, круг 50-5000м, палитра 6 цветов + 8 иконок)
- Синхронная проверка в POST /child/locations: ST_DWithin + GIST
- Debounce 60s + radius-buffer max(30м,15%) — антидребезг GPS
- Web /cabinet/zones: карта всех зон + редактор (адрес + drag-n-drop) + лента событий
- Yandex Geocoder через server-side proxy (ключ не в браузере)
- Soft-delete + pg_cron retention 30д
- В MVP без уведомлений — копим ZoneEvent, push в Phase 5 с mobile-parent

## Test plan

- [ ] pnpm --filter @gmd/backend test && test:e2e — passes
- [ ] pnpm --filter @gmd/web test && test:e2e — passes
- [ ] Локально: создал зону → ребёнок "вошёл" (через 60с отправки двух точек) → entry в ленте
- [ ] Локально: редактирование/удаление зоны работает
- [ ] 152-ФЗ: privacy-policy обновлена + PRIVACY_POLICY_VERSION bump

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: После ревью — merge и tag**

```bash
git checkout main
git pull
git tag v0.14.0
git push origin v0.14.0
gh release create v0.14.0 --title "v0.14.0 — Геозоны" --notes-from-tag
```

- [ ] **Step 7: Prod-deploy**

```bash
bash infra/deploy/deploy.sh
ssh gmd-prod 'docker ps --format "{{.Names}} {{.Status}}"'
curl http://192.168.1.23/api/readyz
```

Expected: все контейнеры healthy, `/readyz` → `{status:ok,db:up,redis:up}`. Миграции применены (Prisma migrate deploy сработает автоматически в скрипте).

- [ ] **Step 8: Prod smoke**

- Залогиниться в https://gmd.link28rus.ru/cabinet (или http://192.168.1.23).
- Создать зону, убедиться что UI работает.
- Проверить через Postgres на проде: `SELECT * FROM zones; SELECT * FROM zone_states;`.
- Отправить фейковую точку от реального тест-ребёнка в зону → дождаться события.

- [ ] **Step 9: Финальный memory save**

```
finish_task(
  topic="GMD Phase 4 — геозоны, v0.14.0 in prod",
  content="Phase 4 закрыта. PR #5, tag v0.14.0, prod-deploy успешный. Ключевое: ...",
  project="gmd",
  session_summary="Phase 4 geofences в prod"
)
```

---

## Итоги плана

**27 задач,** разбитых по 8 milestone'ам из spec'а:

| Task диапазон | Milestone                                               | Объём |
| ------------- | ------------------------------------------------------- | ----- |
| 0             | Git branch                                              | 1     |
| 1-2           | M1 (Prisma + PostGIS + pg_cron)                         | 2     |
| 3-8           | M2 (Backend REST /zones/\*)                             | 6     |
| 9-12          | M3 (ZoneDetectionService + integration + e2e)           | 4     |
| 13-18         | M4 (Web proxy + client + list + map)                    | 6     |
| 19-23         | M5 (Web editor: pickers + address + map + dialog + e2e) | 5     |
| 24            | M6 (Events feed)                                        | 1     |
| 25-26         | M7 (Docs + CHANGELOG)                                   | 2     |
| 27            | M8 (Verify + PR + deploy)                               | 1     |

Каждая задача — TDD-цикл (test → red → green → commit), чистые границы, frequent commits.
