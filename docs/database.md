# Архитектура базы данных

## Обзор

Перископ использует **PostgreSQL 16** с расширением **PostGIS** для геопространственных операций и **pg_cron** для автоматизированных задач очистки данных.

### Технология и инструменты

- **СУБД:** PostgreSQL 16 (контейнер `gmd-postgres:16-postgis-pgcron`)
- **ORM:** Prisma 5 (миграции через `prisma migrate`)
- **Расширения:**
  - `postgis` — геопространственные типы и функции (ST_DWithin, ST_Distance и т.д.)
  - `pg_cron` — планировщик задач для очистки данных по расписанию
- **Источник истины:** [`apps/backend/prisma/schema.prisma`](../apps/backend/prisma/schema.prisma)

### Управление схемой

Все изменения модели данных:

1. Описываются в `schema.prisma`
2. Генерируют миграцию: `pnpm --filter @gmd/backend prisma migrate dev --name <описание>`
3. Автоматически применяются к БД при старте контейнера
4. На production — выполняются в составе рутины deploy (`infra/deploy/deploy.sh`)

---

## Основные таблицы

### Аутентификация и авторизация

#### `users`

- `id` (uuid) — первичный ключ
- `email` (varchar) — уникальный, индексирован
- `emailVerifiedAt` (timestamptz) — время верификации email
- `name` (varchar) — имя пользователя (опционально)
- `locale` (varchar) — локаль интерфейса (по умолчанию `'ru'`)
- `acceptedPrivacyPolicyVersion` (varchar) — версия политики, которую пользователь принял при регистрации
- `passwordHash` (varchar) — argon2id-хэш пароля (null если юзер пока не установил пароль)
- `createdAt`, `updatedAt` (timestamptz)
- `deletedAt` (timestamptz) — soft-delete маркер (null = активный пользователь)

**Связи:** один пользователь → множество memberships (семьи), tokens, OTP-кодов, зон (creator), согласий.

#### `families`

- `id` (uuid) — первичный ключ
- `name` (varchar) — название семьи (по умолчанию «Моя семья»)
- `createdAt`, `updatedAt` (timestamptz)
- `deletedAt` (timestamptz) — soft-delete

**Связи:** каскадная удаление → удаляются все memberships, дети, зоны, приглашения.

#### `memberships`

- `id` (uuid) — первичный ключ
- `userId` (uuid) — foreign key → users
- `familyId` (uuid) — foreign key → families
- `role` (enum: owner | parent) — роль участника в семье
- `createdAt` (timestamptz)

**Уникальность:** `(userId, familyId)` — один пользователь может быть членом семьи максимум один раз.

#### `refresh_tokens`

- `id` (uuid) — первичный ключ
- `userId` (uuid) — foreign key → users
- `tokenHash` (varchar) — SHA256-хэш refresh-токена (опаковый)
- `userAgent`, `ipAddress` (varchar) — метаданные сессии
- `expiresAt` (timestamptz) — TTL токена (обычно 30 дней)
- `revokedAt` (timestamptz) — время отзыва (анти-replay)
- `rotatedToId` (uuid) — ссылка на новый токен при rotation
- `createdAt` (timestamptz)

**Безопасность:** при повторном использовании rotated токена вся цепочка токенов пользователя ревокируется.

#### `otp_codes`

- `id` (uuid) — первичный ключ
- `userId` (uuid) — foreign key (nullable, может быть заполнено только после verify)
- `email` (varchar) — адрес, на который отправлен код
- `codeHash` (varchar) — argon2id-хэш кода
- `purpose` (varchar, по умолчанию `'login'`) — назначение кода
- `expiresAt` (timestamptz) — время истечения (обычно 10 минут)
- `consumedAt` (timestamptz) — время использования кода (null = не использован)
- `attempts` (int) — количество неудачных попыток верификации
- `createdAt` (timestamptz)

**Правила:** максимум 3 попытки верификации → код инвалидируется; новый `request-otp` инвалидирует предыдущий активный код на этот email.

#### `consent_records`

- `id` (uuid) — первичный ключ
- `subjectType` (enum: USER | CHILD) — кто дал согласие
- `userId` (uuid) — foreign key (nullable)
- `childId` (uuid) — foreign key (nullable)
- `documentType` (enum: PRIVACY_POLICY | TERMS_OF_USE | CHILD_14PLUS) — тип документа
- `version` (varchar) — версия документа (e.g. `'1.0'`, `'1.1'`)
- `acceptedAt` (timestamptz)
- `ip`, `userAgent` (varchar) — метаданные согласия (для доказательства per 152-ФЗ)

**Индексы:** по userId + documentType + version; по childId + documentType; по версии для быстрого поиска юзеров, согласивших старую версию.

---

### Дети и их устройства

#### `children`

- `id` (uuid) — первичный ключ
- `familyId` (uuid) — foreign key → families (каскадное удаление)
- `name` (varchar) — имя ребёнка
- `dateOfBirth` (date) — дата рождения (опционально, используется для согласия 14+)
- `avatarKey` (varchar) — ключ изображения в MinIO (опционально)
- `createdAt`, `updatedAt` (timestamptz)
- `deletedAt` (timestamptz) — soft-delete

**Связи:** каскадное удаление при удалении семьи → удаляются также device, зоны, события.

#### `child_devices`

- `id` (uuid) — первичный ключ
- `childId` (uuid) — foreign key → children (UNIQUE, один device на ребёнка)
- `tokenHash` (varchar) — SHA256-хэш long-lived device-token (32 байта)
- `deviceName`, `osVersion`, `appVersion` (varchar) — метаданные устройства
- `lastSeenAt` (timestamptz) — время последнего контакта
- `revokedAt` (timestamptz) — время отзыва токена родителем
- `createdAt` (timestamptz)

**Безопасность:** токен используется для аутентификации всех запросов ребёнка через заголовок `X-Child-Token`.

---

### Геолокация (Phase 1.3)

#### `locations`

- `id` (uuid) — первичный ключ
- `childId` (uuid) — foreign key → children
- `childDeviceId` (uuid) — foreign key → child_devices (для quick ref)
- `lat`, `lon` (float8) — координаты WGS84 (EPSG:4326)
- `accuracy` (float8) — точность GPS в метрах (опционально)
- `altitude`, `speed`, `bearing` (float8) — доп. характеристики движения
- `batteryLevel` (int) — % батареи
- `isCharging` (bool) — заряжается ли устройство
- `provider` (varchar) — источник геолокации (e.g. `'gps'`, `'network'`)
- `recordedAt` (timestamptz) — время записи на устройстве (client time)
- `serverReceivedAt` (timestamptz, default now()) — время получения сервером

**Уникальность:** `(childDeviceId, recordedAt)` — защита от дублей при retry-запросах.

**Индексы:**

- `(childId, recordedAt DESC)` — быстрый поиск истории ребёнка
- GIST-индекс для будущих геопространственных запросов (в Prisma: `generated geography`)

**Retention:** автоматическое удаление записей старше 30 дней через pg_cron job `locations_retention_30d` (запускается ежедневно в 03:00 UTC).

#### `sos_events`

- `id` (uuid) — первичный ключ
- `childId` (uuid) — foreign key → children
- `childDeviceId` (uuid) — foreign key → child_devices
- `lat`, `lon`, `accuracy` (float8) — координаты события SOS
- `recordedAt` (timestamptz) — время события на устройстве
- `serverCreatedAt` (timestamptz, default now()) — время на сервере
- `message` (varchar, макс 500 символов) — опциональное сообщение от ребёнка
- `acknowledgedAt` (timestamptz) — время ответа родителя
- `acknowledgedBy` (varchar) — кто подтвердил (user ID)

**Индекс:** `(childId, serverCreatedAt DESC)` — быстрый поиск недавних SOS.

---

## Геозоны (Phase 4)

### `zones`

Таблица геозон, создаваемых родителем.

- `id` (uuid) — первичный ключ
- `familyId` (uuid) — foreign key → families (каскадное удаление)
- `name` (varchar, макс 60 символов) — название зоны (e.g. «Школа»)
- `color` (varchar) — HEX-цвет границы (e.g. `'#FF5733'`), валидируется regex `^#[0-9a-fA-F]{6}$`
- `icon` (varchar) — иконка из фиксированного набора (e.g. `'school'`, `'home'`, `'basketball'`)
- `centerLat`, `centerLon` (float8) — координаты центра WGS84
- `radius` (int) — радиус в метрах, CHECK `BETWEEN 50 AND 5000`
- `createdBy` (uuid) — foreign key → users (RESTRICT, чтобы не ломать историю)
- `createdAt`, `updatedAt` (timestamptz)
- `deletedAt` (timestamptz) — soft-delete зоны

**Generated-колонка (PostGIS):** `center_geo geography(Point, 4326)` — вычисляемая точка для быстрых ST_DWithin запросов.

**Индексы:**

- `(familyId, deletedAt)` — список зон семьи
- GIST-индекс на `center_geo` для ST_DWithin запросов

**Уникальность:** `(familyId, name) WHERE deletedAt IS NULL` — в семье не может быть двух активных зон с одинаковым названием.

**Ограничение:** максимум 20 зон на семью (проверяется в приложении).

### `zone_child_assignments`

M2M таблица связи зон и детей.

- `id` (uuid) — первичный ключ
- `zoneId` (uuid) — foreign key → zones (CASCADE)
- `childId` (uuid) — foreign key → children (CASCADE)
- `createdAt` (timestamptz)

**Уникальность:** `(zoneId, childId)` — один ребёнок привязан к зоне максимум один раз.

**Индекс:** `(childId)` — быстрый поиск всех зон, в которых находится ребёнок.

### `zone_events`

Событие входа или выхода ребёнка из зоны. Создаётся автоматически при обработке GPS-точки.

- `id` (uuid) — первичный ключ
- `zoneId` (uuid) — foreign key → zones (CASCADE)
- `childId` (uuid) — foreign key → children (CASCADE)
- `type` (enum: entry | exit) — направление события
- `lat`, `lon` (float8) — координаты точки, которая сработала событие
- `accuracy` (float8) — точность в момент события
- `recordedAt` (timestamptz) — время точки на устройстве
- `createdAt` (timestamptz) — время события на сервере

**Индексы:**

- `(childId, recordedAt DESC)` — история событий конкретного ребёнка
- `(zoneId, recordedAt DESC)` — история событий в конкретной зоне

**Retention:** автоматическое удаление старше 30 дней через pg_cron job `zone_events_retention` (запускается ежедневно в 03:05 UTC).

### `zone_states`

Состояние: находится ли ребёнок внутри зоны (используется для debounce и предотвращения duplicate-событий).

- `id` (uuid) — первичный ключ
- `zoneId` (uuid) — foreign key → zones (CASCADE)
- `childId` (uuid) — foreign key → children (CASCADE)
- `isInside` (bool, default false) — текущее подтверждённое состояние
- `pendingTransition` (bool, default false) — флаг ожидания (во время debounce 60 сек)
- `pendingSince` (timestamptz) — когда начал debounce
- `lastConfirmedChange` (timestamptz) — время последнего подтвержённого события
- `updatedAt` (timestamptz)

**Уникальность:** `(zoneId, childId)` — одна строка на пару (зона, ребёнок).

**Индекс:** `(childId)` — быстрый поиск всех состояний ребёнка.

**Логика debounce:**

1. GPS-точка обрабатывается, проверяется, находится ли ребёнок внутри/снаружи зоны (ST_DWithin + buffer).
2. Если состояние отличается от `isInside` → устанавливается `pendingTransition = true`, `pendingSince = now()`.
3. Каждые 60 секунд cron-задача проверяет, есть ли точки в течение этих 60 сек, подтверждающие состояние → переводит в `isInside`, создаёт ZoneEvent, очищает pending-флаги.
4. Буферная зона при exit: использует `max(30 м, 15% от radius)` чтобы избежать ложных срабатываний при колебаниях GPS у границы.

---

## Стратегия soft-delete и retention

### Логика удаления

**Soft-delete** срабатывает на:

- `users` — `DELETE /me` → `deletedAt = now()`
- `families` — удаление семьи родителем → `deletedAt = now()`
- `children` — удаление ребёнка → `deletedAt = now()`
- `child_devices` — отзыв устройства родителем → `revokedAt = now()` (не soft-delete, отдельный флаг)
- `zones` — удаление зоны → `deletedAt = now()`

### Автоматическая очистка (pg_cron)

1. **`locations_retention_30d`** — удаляет записи из `locations` старше 30 дней (03:00 UTC ежедневно).
2. **`zone_events_retention`** — удаляет из `zone_events` старше 30 дней (03:05 UTC ежедневно).
3. **`users_hard_delete`** — удаляет пользователей с `deletedAt < now() - interval '30 days'` (03:10 UTC ежедневно).
4. **`zones_hard_delete`** — удаляет зоны с `deletedAt < now() - interval '30 days'` (03:15 UTC ежедневно).

**Каскадное удаление:** при hard-delete пользователя или семьи все связанные записи (дети, devices, локации, зоны, события, согласия) удаляются автоматически через foreign key CASCADE.

---

## Миграции и управление версией схемы

Все миграции хранятся в `apps/backend/prisma/migrations/` в текстовом формате `.sql`. При pull/deploy новых изменений:

```bash
# На dev-машине
pnpm --filter @gmd/backend prisma migrate dev

# На production (автоматически в deploy.sh)
pnpm --filter @gmd/backend prisma migrate deploy
```

Миграции идемпотентны и безопасны для production (используется таблица `_prisma_migrations` для отслеживания версии).

---

## Безопасность и производительность

### Индексы по приоритету

| Приоритет | Таблица         | Индекс                               | Причина                           |
| --------- | --------------- | ------------------------------------ | --------------------------------- |
| P0        | locations       | `(childId, recordedAt DESC)`         | основной запрос истории локаций   |
| P0        | zones           | GIST на `center_geo`                 | ST_DWithin в обработке GPS-точек  |
| P0        | zone_events     | `(childId, recordedAt DESC)`         | лента событий ребёнка             |
| P1        | children        | `(familyId, deletedAt)`              | список детей семьи                |
| P1        | users           | `(email)`                            | поиск по email при входе          |
| P1        | zones           | `(familyId, deletedAt)`              | список зон семьи                  |
| P2        | consent_records | `(userId, documentType, acceptedAt)` | проверка согласия перед мутациями |
| P2        | refresh_tokens  | `(userId, revokedAt)`                | поиск активных токенов            |

### Anti-enumeration

- Все endpoints проверяют доступ через `FamilyAccessGuard` → возвращают 404 `child_not_found` даже если ребёнок удалён (soft-delete).
- Разграничение по семье: родитель видит только детей своей семьи.

---

## Просмотр текущей схемы

**Актуальный источник:** [`apps/backend/prisma/schema.prisma`](../apps/backend/prisma/schema.prisma).

**Визуализация в Prisma Studio:**

```bash
pnpm --filter @gmd/backend prisma studio
```

Откроется интерактивная веб-GUI для просмотра и редактирования данных (только для dev).

---

## Вопросы и контакты

При необходимости изменения схемы — открыть issue в repo или связаться с [link28rus@gmail.com](mailto:link28rus@gmail.com).
