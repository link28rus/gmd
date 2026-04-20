# GMD Phase 4 — Геозоны (geofences): design

**Дата:** 2026-04-20
**Автор:** Claude (brainstorming session) + Ihor (link28rus)
**Статус:** design approved, переходит в writing-plans
**Ветка:** `feature/phase-4-geofences` от `main`
**Целевой релиз:** `v0.14.0`

---

## 1. Цель и ценность

Геозоны — killer-фича аналогов (gdemoideti.ru, Life360). Родитель задаёт круговые зоны («Школа», «Дом», «Кружок») и получает события входа/выхода ребёнка. В MVP Phase 4 — без каналов уведомлений: события копятся в БД, отображаются в web-кабинете. FCM push, email и расписание зон — в Phase 5+ (вместе с mobile-parent приложением).

**User story:**

> Как родитель, я хочу нарисовать на карте зону «Школа» и видеть в кабинете, когда мой ребёнок зашёл туда и когда ушёл, — чтобы понимать, дошёл ли он вовремя.

## 2. В скоупе Phase 4

- Модель `Zone` — круг (center + radius), до 20 на семью.
- Assignment детей (many-to-many Zone ↔ Child), по умолчанию «все дети» при создании.
- Синхронная проверка зон в `POST /child/locations` (PostGIS `ST_DWithin` + GIST-индекс).
- События `ZoneEvent` (entry / exit) + retention 30 дней (pg_cron).
- Debounce 60 сек + радиус-буфер 30м/15% для антидребезга GPS.
- Cold-start: создание зоны инициализирует `ZoneState` без события; в UI — badge текущего статуса.
- Web-страница `/cabinet/zones`: список + карта + редактор (адрес-поиск + drag-n-drop) + лента событий.
- Yandex Geocoder через server-side Next.js proxy (ключ не в браузере).
- Soft-delete зоны + hard-delete через 30 дней pg_cron.
- Документация (ERD, API, 152-ФЗ) + bump `PRIVACY_POLICY_VERSION` + новая запись в `privacy-policy.md`.

## 3. Вне скоупа Phase 4 (отложено)

- **Любые уведомления** (email, Web Push, FCM) — `ZoneEvent` только копятся.
- **Расписание зон** («активно пн–пт 07:00–18:00») — always-on в MVP.
- **Полигональные зоны** — только круг.
- **Dwell-события** («находится в зоне X минут») — только entry/exit.
- **Per-user настройки каналов уведомлений** — нет каналов → нет настроек.
- **BullMQ/Redis для зон** — проверка синхронна, очередь не нужна.
- **Mobile-parent интеграция** — приложение ещё не существует.

## 4. Нефункциональные требования и ограничения

- **152-ФЗ:** Zone/ZoneEvent хранятся в РФ, CASCADE при удалении Child/Family, retention 30 дней через pg_cron. Новый пункт в политике конфиденциальности.
- **Производительность:** ST_DWithin по GIST-индексу `zones.center_geo`, ожидаемо <5мс на точку для 20 зон/семья. POST /child/locations остаётся в существующем rate limit (6 req/min/device).
- **Целостность:** проверка зон и запись событий — в той же транзакции, что и INSERT Location. Либо всё, либо ничего.
- **Безопасность:** anti-enumeration — чужие зоны/события возвращают 404, не 403.
- **DX:** OpenAPI codegen для shared-types, совпадает с существующим паттерном Phase 1.3.

## 5. Принятые решения (архитектурные)

| #   | Решение                                      | Альтернатива                          | Обоснование                                                                                         |
| --- | -------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Синхронная проверка зон в POST ingest        | Async worker через BullMQ             | В MVP нет уведомлений → очередь не нужна. ZoneEvent создаётся сразу, в одной транзакции.            |
| 2   | Per-family Zone + явный assignment на детей  | Per-child / Per-family без assignment | Один «Дом» для всех, при этом «Школа Ани» — только Ане. Дефолт «все дети» при создании.             |
| 3   | Только круг, 50–5000 м                       | Полигон                               | Drag-n-drop круга тривиально; полигон требует сложного UI. Полигоны — Phase 5+.                     |
| 4   | Только entry/exit, без dwell                 | entry + exit + dwell                  | Dwell требует cron/worker — избыточно для MVP.                                                      |
| 5   | Debounce 60s + буфер `max(30м, radius×0.15)` | Только debounce / только буфер        | Два ортогональных механизма борьбы с дребезгом: jitter (буфер) + transitional motion (debounce).    |
| 6   | Cold-start: badge статуса, без события       | Событие при создании                  | Семантика «event» — переход, а не инициализация. Badge показывает «сейчас внутри».                  |
| 7   | Always-on, без расписания                    | Опциональное расписание               | Без push расписание не критично — лента фильтруется в UI. Добавим в Phase 5.                        |
| 8   | Никаких уведомлений в MVP                    | Email / Web Push / FCM                | Без mobile-parent push не имеет смысла; email — лишний шум. Ценность «лента в кабинете» достаточна. |
| 9   | UX создания — гибрид (адрес-поиск + drag)    | Только drag / только адрес            | Yandex Geocoder в бесплатной квоте (25k/день). Адрес = human-readable, drag = тонкая настройка.     |
| 10  | Soft-delete Zone через `deletedAt`           | Hard-delete                           | Родитель не теряет историю событий при передумывании. Hard-delete — через 30 дней pg_cron.          |

## 6. Модель данных

### 6.1 Prisma schema (дельта к существующей)

```prisma
model Zone {
  id        String    @id @default(cuid())
  familyId  String
  name      String    @db.VarChar(60)
  color     String    // hex из фиксированной палитры
  icon      String    // enum-строка: home, school, sport, art, hospital, shop, other
  centerLat Float
  centerLon Float
  radius    Int       // метры
  createdBy String    // userId
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
  isInside            Boolean
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

Также добавить обратные relations в `Family`, `Child`, `User`.

### 6.2 Raw-SQL миграция поверх Prisma

```sql
-- Generated geography column + GIST-индекс
ALTER TABLE zones
  ADD COLUMN center_geo geography(Point, 4326)
  GENERATED ALWAYS AS (ST_MakePoint(center_lon, center_lat)::geography) STORED;

CREATE INDEX zones_center_geo_gist ON zones USING GIST (center_geo);

-- Валидационные CHECK-constraints
ALTER TABLE zones
  ADD CONSTRAINT zones_radius_range CHECK (radius BETWEEN 50 AND 5000),
  ADD CONSTRAINT zones_lat_range CHECK (center_lat BETWEEN -90 AND 90),
  ADD CONSTRAINT zones_lon_range CHECK (center_lon BETWEEN -180 AND 180),
  ADD CONSTRAINT zones_name_length CHECK (char_length(name) BETWEEN 1 AND 60);
```

### 6.3 pg_cron задачи

Добавить к существующему `location-retention` джобу:

```sql
SELECT cron.schedule('zone-events-retention', '0 3 * * *',
  $$ DELETE FROM zone_events WHERE created_at < now() - interval '30 days'; $$);

SELECT cron.schedule('zones-hard-delete', '15 3 * * *',
  $$ DELETE FROM zones WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'; $$);
```

### 6.4 Application-level инварианты

- `Zone.count WHERE familyId=X AND deletedAt IS NULL ≤ 20` — проверяется в `ZonesService.create`, при превышении → 409 `zone_limit_reached`.
- `ZoneChildAssignment.child.familyId === zone.familyId` — проверяется при assign/create, иначе → 422 `cross_family_assignment`.
- `color ∈ {#22c55e, #3b82f6, #f59e0b, #ef4444, #a855f7, #64748b}` — Zod validation.
- `icon ∈ ['home','school','sport','art','hospital','shop','music','other']` — Zod validation.

## 7. Backend API

### 7.1 Эндпоинты

Все эндпоинты — под `JwtAuthGuard` + `FamilyAccessGuard` (родитель только своей семьи).

| Метод  | Путь                  | Смысл                                                              | Коды                                    |
| ------ | --------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| POST   | `/zones`              | Создать зону                                                       | 201, 400, 409 `zone_limit_reached`, 422 |
| GET    | `/zones`              | Список зон семьи + assignments + states                            | 200                                     |
| GET    | `/zones/:id`          | Одна зона + последние 50 событий                                   | 200, 404                                |
| PATCH  | `/zones/:id`          | Обновить поля и assignments                                        | 200, 400, 404, 422                      |
| DELETE | `/zones/:id`          | Soft-delete (deletedAt)                                            | 204, 404                                |
| GET    | `/zones/events`       | Лента событий (?childId, ?zoneId, ?from, ?to, ?cursor, ?limit≤100) | 200                                     |
| GET    | `/children/:id/zones` | Зоны, назначенные ребёнку, + states                                | 200, 404                                |

Тела запросов/ответов — в `apps/backend/src/zones/dto/*.schema.ts` через Zod.

### 7.2 Rate limits

- `POST /zones`, `PATCH /zones/:id`, `DELETE /zones/:id` — 10 req/min/user.
- `GET` — стандартный (inherit from app-level).

### 7.3 Изменение `POST /child/locations`

Существующий `LocationsService.ingest()` расширяется: внутри транзакции после `INSERT Location` для каждой точки вызывается `ZoneDetectionService.processPoint(tx, childId, familyId, point)`.

**Псевдокод `processPoint`:**

```
1. candidateZones = SELECT z.id, z.radius, z.center_geo
     FROM zones z
     JOIN zone_child_assignments a ON a.zone_id = z.id
     WHERE z.family_id = $familyId
       AND a.child_id = $childId
       AND z.deleted_at IS NULL
       AND ST_DWithin(z.center_geo, ST_MakePoint($lon, $lat)::geography, z.radius + max(30, z.radius * 0.15))

2. Для каждой zone:
     distance = ST_Distance(zone.center_geo, point)
     buffer = max(30, zone.radius * 0.15)

     isInsideStrict = distance <= zone.radius
     isInsideLoose  = distance <= zone.radius + buffer

     state = UPSERT ZoneState (zoneId, childId) default {isInside: false}

     # Candidate — целевое состояние с учётом hysteresis
     if isInsideStrict:
       candidate = true
     elif isInsideLoose:
       candidate = state.isInside  # в буфере — не меняем
     else:
       candidate = false

     if candidate == state.isInside:
       # состояние стабильно — сбрасываем pending
       if state.pendingTransition:
         UPDATE ZoneState SET pendingTransition=false, pendingSince=NULL
       continue

     # Kандидат отличается — debounce-логика
     if !state.pendingTransition:
       UPDATE ZoneState SET pendingTransition=true, pendingSince=recordedAt
       continue

     elapsed = recordedAt - state.pendingSince
     if elapsed >= 60 seconds:
       eventType = candidate ? 'entry' : 'exit'
       INSERT ZoneEvent (zoneId, childId, type=eventType, lat, lon, accuracy, recordedAt)
       UPDATE ZoneState SET
         isInside = candidate,
         pendingTransition = false,
         pendingSince = NULL,
         lastConfirmedChange = recordedAt
     # else: продолжаем ждать подтверждения
```

### 7.4 Инициализация ZoneState при create/update zone

- `POST /zones`: для каждого `childId` в `childIds[]` → `INSERT ZoneState (zoneId, childId, isInside=false)`.
- `PATCH /zones/:id` с изменением assignments: `INSERT` для добавленных, `DELETE` для убранных.
- `DELETE /zones/:id` (soft): `ZoneState` НЕ трогаем (восстановление не предусмотрено, но hard-delete через 30д удалит CASCADE).

### 7.5 Структура NestJS-модуля

```
apps/backend/src/zones/
  zones.module.ts
  zones.controller.ts
  zones.service.ts
  zone-detection.service.ts
  dto/
    create-zone.schema.ts
    update-zone.schema.ts
    zone.dto.ts
    zone-event.dto.ts
    zones-events-query.schema.ts
  zones.controller.spec.ts
  zones.service.spec.ts
  zone-detection.service.spec.ts

apps/backend/test/e2e/zones.e2e-spec.ts
apps/backend/test/e2e/zone-ingest.e2e-spec.ts
```

Интеграция: `LocationsService` → inject `ZoneDetectionService`.

## 8. Web-кабинет

### 8.1 Структура

```
apps/web/app/cabinet/zones/
  page.tsx                        # SSR shell, проверка auth
  zones-client.tsx                # корневой client-component
  components/
    zones-list.tsx                # левая колонка
    zones-map.tsx                 # правая колонка — карта всех зон
    zone-card.tsx                 # карточка в списке
    zone-editor-dialog.tsx        # shadcn Dialog создания/редактирования
    zone-editor-map.tsx           # карта внутри редактора (drag + круг)
    address-search.tsx            # автокомплит через /api/geocode
    color-picker.tsx              # 6 цветов
    icon-picker.tsx               # 8 иконок
    zone-events-feed.tsx          # лента событий с polling 30с

apps/web/app/api/zones/
  route.ts                        # GET list, POST create
  [id]/route.ts                   # GET, PATCH, DELETE
  events/route.ts                 # GET feed

apps/web/app/api/geocode/
  route.ts                        # proxy на Yandex Geocoder (server-side key)

apps/web/lib/api/
  zones.ts                        # типизированный клиент
  geocode.ts                      # клиент для /api/geocode

apps/web/hooks/
  use-zones.ts                    # SWR-like fetcher
  use-zone-events.ts              # polling с visibility awareness
```

### 8.2 Layout страницы

- **Desktop (≥1024px):** split 1/2. Слева — скролл-список зон (карточки). Справа — полноразмерная YMap со всеми кругами + маркерами детей.
- **Mobile (<1024px):** карта сверху 60vh, список снизу. Tab-switch «Зоны / Лента событий».

### 8.3 UX создания зоны (гибрид)

1. Клик «+ Новая зона» → открывается `ZoneEditorDialog` (shadcn, fullscreen на mobile).
2. Шаг 1 — адрес: поле `AddressSearch` с debounce 400мс, запрос `/api/geocode?q=...&lang=ru`. Результаты — выпадающий список, клик → установка pin на карте, центрирование карты на точке.
3. Шаг 2 — drag-настройка: на карте виден круг (default radius 250м). Центр draggable (перетаскивание pin'а обновляет lat/lon). Handle на границе круга draggable → меняет radius. Live-отображение «Радиус: 340 м».
4. Шаг 3 — метаданные: поле имени (Zod: 1–60 символов), color-picker (6 чипов), icon-picker (8 иконок), multi-select детей (default: все).
5. Кнопка «Сохранить» → `POST /api/zones` → на успехе Dialog закрывается, список обновляется, новая зона highlight 2 сек.
6. Edit-режим: тот же Dialog с pre-filled state.

### 8.4 Fallback для Yandex Geocoder

Если `/api/geocode` возвращает 5xx/timeout → в UI показываем toast «Адрес-поиск недоступен, используйте клик по карте». Редактор продолжает работать в pure-drag режиме (вариант A из brainstorming).

### 8.5 Proxy и ключи

- `YANDEX_GEOCODER_API_KEY` — отдельная env var от `YANDEX_MAPS_API_KEY` (разные квоты). Хранится в `apps/web/.env.local` + `infra/docker/.env.prod`.
- `/api/geocode/route.ts` — server-side Node runtime, ключ **никогда** не попадает в браузер.
- Кэш на клиенте: последние 10 запросов в `sessionStorage` (TTL 1 час).

### 8.6 Ленту событий

- `GET /api/zones/events?limit=50` + polling 30с (visibility-aware, паттерн из `useLatestLocation`).
- Вид строки: `[HH:MM] <icon> <ChildName> <вошла/вышла> «<ZoneName>»`.
- Фильтры: ребёнок, зона, период (сегодня / вчера / 7 дней).
- Пустое состояние: «Событий пока нет — зоны активируются при следующей точке от устройства ребёнка».

### 8.7 Навигация

Новый пункт в сайдбаре кабинета: «🎯 Геозоны» → `/cabinet/zones`.

## 9. Документация (обновления в этом же PR)

- **`docs/database.md`** — ERD с новыми таблицами, описание `center_geo` generated column.
- **`docs/privacy-policy.md`** — новый пункт про геозоны. Bump `PRIVACY_POLICY_VERSION`.
- **`docs/152fz-checklist.md`** — строка про zones/zone_events retention и CASCADE.
- **`apps/backend/openapi.yaml`** — пути `/zones/*`, regenerate `packages/shared-types`.
- **`README.md`** — пункт «Геозоны» в списке фич MVP.
- **`CLAUDE.md`** — если меняются команды/скрипты.
- **`CHANGELOG.md`** — запись `v0.14.0` (см. секцию 10).

## 10. CHANGELOG v0.14.0

```md
## v0.14.0 — 2026-04-XX

### Новые возможности

- **Геозоны** — создайте круговую зону на карте (дом, школа, кружок), назначьте детей, и кабинет автоматически запишет, когда ребёнок зашёл или вышел. До 20 зон на семью. Уведомления появятся в мобильном приложении (скоро)
- **Карта всех зон и текущее положение детей** — на странице «Геозоны» сразу видно, где сейчас каждый ребёнок относительно ваших зон

### Улучшения

- **Защита от GPS-дрожи** — события «вошёл/вышел» срабатывают только после 60 секунд устойчивого состояния, плюс буферная зона 15% радиуса при выходе — без ложных срабатываний при прогулках у границы

### Изменения

- feat(backend): таблицы `zones`, `zone_child_assignments`, `zone_events`, `zone_states` + generated `center_geo geography` + GIST-индекс
- feat(backend): синхронная проверка зон в `POST /child/locations`
- feat(backend): REST `/zones/*` — CRUD + `/zones/events` лента
- feat(web): страница `/cabinet/zones` с Яндекс-картой, редактором (адрес + drag) и лентой событий
- feat(web): proxy-роуты `/api/zones/*` + client `lib/api/zones`
- feat(web): server-side proxy `/api/geocode` для Yandex Geocoder (ключ не в браузере)
- chore(infra): pg_cron-задачи `zone-events-retention` (30д) и `zones-hard-delete` (30д после soft-delete)
- chore(privacy): bump `PRIVACY_POLICY_VERSION`, новый пункт про обработку геозон
```

## 11. План по milestone'ам

| #   | Milestone                                                               | Зависимости | Ожидаемый объём тестов               |
| --- | ----------------------------------------------------------------------- | ----------- | ------------------------------------ |
| M1  | Prisma schema + raw-SQL миграция + pg_cron                              | —           | smoke (prisma studio)                |
| M2  | Backend REST `/zones/*` CRUD + `/zones/events`                          | M1          | ~25 unit + ~10 e2e                   |
| M3  | Backend движок проверки зон в ingest (`ZoneDetectionService`)           | M1, M2      | ~15 unit + 3-4 integration с PostGIS |
| M4  | Web: страница `/cabinet/zones`, list + map view                         | M2          | ~10 unit + 1 Playwright smoke        |
| M5  | Web: редактор зоны (адрес + drag)                                       | M4          | ~12 unit + 2 Playwright              |
| M6  | Web: лента событий + badge «сейчас внутри»                              | M4          | ~6 unit                              |
| M7  | Документация + CHANGELOG + privacy-policy bump                          | M2, M3      | —                                    |
| M8  | Verification (все тесты, lint, typecheck) + prod-deploy + tag `v0.14.0` | все         | full test run                        |

**Оценка:** 7–10 сессий subagent-driven execution.

## 12. Открытые вопросы (deferred to Phase 5+)

1. Расписание зон (активно пн–пт 07:00–18:00) — вернёмся с push-уведомлениями.
2. Dwell-события («в школе > 2 часов»).
3. Полигональные зоны.
4. FCM push на mobile-parent (когда приложение появится).
5. Per-user/per-zone настройки каналов уведомлений.
6. Объединённые уведомления при перекрывающихся зонах.

## 13. Риски и митигации

| Риск                                                                                        | Митигация                                                                                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PostGIS `ST_DWithin` тормозит на >1000 зон/семья                                            | Хард-лимит 20 + GIST-индекс. Нагрузочный тест в M3.                                                                               |
| Transit-through (проехал мимо школы за 30 сек) триггерит entry+exit                         | Debounce 60 сек фильтрует такие транзиты.                                                                                         |
| GPS-jitter на границе радиуса                                                               | Буфер 15% на exit + debounce + логика candidate-state в `processPoint`.                                                           |
| Yandex Geocoder превысит квоту 25k/день                                                     | Кэш sessionStorage клиента + fallback на pure-drag. На текущем масштабе (десятки пользователей) невозможно приблизиться к лимиту. |
| Privacy policy bump заблокирует ingest до принятия родителем                                | By design (это правильно). В UI — баннер «обновлена политика».                                                                    |
| Пользователь создаёт 20 зон, потом удаляет → лимит не освобождается мгновенно (soft-delete) | `Zone.count WHERE deletedAt IS NULL` — soft-deleted не считаются, лимит освобождается сразу.                                      |
