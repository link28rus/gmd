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
2. Генерируют миграцию: `pnpm --filter @periscop/backend prisma migrate dev --name <описание>`
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
- `avatarKey` (varchar, nullable, с v0.61.0) — аватар ребёнка:
  `NULL` — первая буква имени (по умолчанию); `preset:<id>` — стандартный аватар, `<id>` из
  `fox bear panda cat bunny owl penguin frog lion koala puppy tiger` (`CHILD_AVATAR_PRESETS`
  в `apps/backend/src/children/dto/set-child-avatar.dto.ts`); `photo:<version>` — своё фото
  в `child_avatar_photos`, `<version>` = первые 12 hex sha256 байтов (ключ кэша на клиентах).
  Пишется вместе с `child_avatar_photos` в одной транзакции
  (`PUT`/`DELETE /family/children/:childId/avatar`). Контракт —
  [spec](superpowers/specs/2026-09-29-child-avatars.md)
- `createdAt`, `updatedAt` (timestamptz)
- `deletedAt` (timestamptz) — soft-delete

**Связи:** каскадное удаление при удалении семьи → удаляются также device, зоны, события.

#### `child_avatar_photos` (v0.61.0)

Своё фото ребёнка, 1:1 с `children`. Отдельной таблицей, чтобы байты не тянулись в каждую
выборку `Child`. Фото — ПДн (152-ФЗ): отдаётся только через `GET /family/children/:childId/avatar`
под JWT родителя семьи ребёнка; у soft-deleted ребёнка не отдаётся (404).

- `childId` — первичный ключ, foreign key → children (CASCADE — уходит вместе с hard-delete ребёнка)
- `mime` (text) — `image/jpeg` | `image/png` | `image/webp`; сигнатура файла сверяется с `mime`
- `sha256` (text) — hex sha256 байтов (64 символа); отдаётся как `ETag`
- `data` (bytea) — байты фото, ≤300 КБ (иначе `413 avatar_too_large`). Сжимает клиент, сервер
  не перекодирует
- `updatedAt` (timestamptz)

Строка удаляется при выборе пресета и при «Убрать» (`DELETE .../avatar`).

#### `child_devices`

- `id` (uuid) — первичный ключ
- `childId` (uuid) — foreign key → children (UNIQUE, один device на ребёнка)
- `tokenHash` (varchar) — SHA256-хэш long-lived device-token (32 байта)
- `deviceName`, `osVersion`, `appVersion` (varchar) — метаданные устройства; с v0.57.0
  `appVersion` обновляется при каждом подключении к realtime-каналу (`hello`), а не только при claim
- `lastSeenAt` (timestamptz) — время последнего контакта (REST-запросы ребёнка + `pong`
  realtime-канала раз в 45 с)
- `revokedAt` (timestamptz) — время отзыва токена родителем
- `createdAt` (timestamptz)
- `diagConfig` (jsonb, nullable, v0.60.0) — настройки журнала приложения (`DiagConfig`: какие
  категории отправлять, подробный режим до `debugUntil`, logcat, снимок состояния, автоотправка);
  `NULL` = значения по умолчанию. Телефон получает их по realtime-каналу (`DIAG_CONFIG`) при каждом
  подключении и после изменения в админке, плюс `GET /child/diag/config`. Контракт —
  [spec](superpowers/specs/2026-09-29-child-diag-logs.md)
- `micReady` (boolean, nullable, v0.62.0) — готовность микрофона для «Звука вокруг» (служба
  микрофона на телефоне в foreground). `false` — Android 14+ не дал запустить её из фона (после
  перезагрузки/самообновления, пока ребёнок не нажал уведомление или не открыл приложение);
  `NULL` — неизвестно (старое приложение). Пишется из realtime `hello.micReady` и
  `{op:'status', micReady}` только при смене значения; отдаётся в `GET /family/children` как
  `device.micReady`. Контракт — [spec](superpowers/specs/2026-09-29-sound-around-mic-blocked.md)
- `micReadyAt` (timestamptz, nullable, v0.62.0) — время последней смены `micReady`

Enum `AudioFailureReason` (`audio_sessions.failureReason`) с v0.62.0 дополнен `MIC_BLOCKED` —
телефон сообщает его через `POST /child/audio/sessions/:id/error`, когда система не дала включить
микрофон из фона.

**Безопасность:** токен используется для аутентификации всех запросов ребёнка через заголовок `X-Child-Token`.

#### `diag_log_uploads` (v0.60.0)

Журнал приложения ребёнка (DiagLog + logcat + снимок состояния), загруженный телефоном через
`POST /child/diag/logs` — по запросу администратора (команда `UPLOAD_DIAG` в `device_commands`,
TTL 24 ч) или сам при сбое. Смотрит только администратор (в журнале бывают координаты и события).

- `id` (cuid) — первичный ключ
- `childDeviceId` — foreign key → child_devices (CASCADE)
- `childId` — foreign key → children (CASCADE)
- `reason` (text) — `manual` (по запросу) | `auto` (при сбое)
- `trigger` (text, nullable) — причина автоотправки (`audio_start_failed`, `crash`, …)
- `commandId` (text, nullable) — id команды `UPLOAD_DIAG`; при загрузке команда помечается `executed`
- `appVersion` (text, nullable) — версия приложения на телефоне
- `sizeBytes` (int) — сумма UTF-8 длин `snapshot` + `log` + `logcat`
- `snapshot` (text, ≤64 КБ), `log` (text, ≤2 МБ), `logcat` (text, ≤2 МБ) — все nullable
- `createdAt` (timestamptz)

**Индексы:** `(childId, createdAt DESC)`, `(childDeviceId, createdAt DESC)`.

**Retention:** без pg_cron — при каждой новой загрузке удаляются журналы старше 14 дней (всех
устройств) и всё сверх 30 последних на устройство (`DiagService.applyRetention`).

**Связанное:** `DeviceCommandType` пополнился значением `UPLOAD_DIAG` (миграция
`20260929120000_child_diag_logs`).

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
- `trackFlag` (text, nullable, v0.63.0) — пригодность точки для маршрута: `NULL` — годится;
  `coarse` — погрешность хуже `track.accuracy_max_m`; `outlier` — телепорт или «игла»;
  `mock` — подделка GPS. Помеченные точки хранятся (по ним видно последнее местоположение),
  но не попадают в трек, поездки и геозоны (`outlier`/`mock`). Размечаются при приёме
  (`locations/track-quality.ts`), история переразмечается при старте backend, если сменилась
  версия правил (`system.track_rules_version` в `app_settings`)

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
- `radius` (int) — радиус в метрах, CHECK `BETWEEN 50 AND 5000` (с v0.64.0 API принимает 100..5000)
- `allChildren` (bool, default false, v0.64.0) — зона для всех детей семьи, включая будущих; явных
  назначений в `zone_child_assignments` у такой зоны нет
- `timezone` (text, nullable, v0.65.0) — IANA-пояс зоны (из браузера родителя при сохранении);
  обязателен, если задано расписание или срок
- `scheduleDaysMask`, `scheduleStartMin`, `scheduleEndMin` (int, nullable, v0.65.0) — окно
  уведомлений о приходе/уходе: маска дней (бит0 = ПН … бит6 = ВС), минуты дня `[start, end)`,
  через полночь, если `end < start`. Вне окна push не шлётся, событие пишется
- `arrivalDeadlineMin`, `arrivalDaysMask` (int, nullable), `arrivalGraceMin` (int, default 10)
  (v0.65.0) — «не пришёл к сроку»: срок (минута дня), дни, запас в минутах
- `createdBy` (uuid) — foreign key → users (RESTRICT, чтобы не ломать историю)
- `createdAt`, `updatedAt` (timestamptz)
- `deletedAt` (timestamptz) — soft-delete зоны

**Generated-колонка (PostGIS):** `center_geo geography(Point, 4326)` — вычисляемая точка для
`ST_Distance` при обработке GPS-точек. Prisma её не видит: `migrate diff` генерирует
`DROP COLUMN "center_geo"`, из новых миграций его вычищать руками.

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
- `type` (enum: entry | exit | missed_arrival | no_data) — вход, выход; с v0.65.0 также «не пришёл
  к сроку» и «нет данных от телефона к сроку» (координаты — последняя точка ребёнка или центр зоны)
- `lat`, `lon` (float8) — координаты точки, которая сработала событие
- `accuracy` (float8) — точность в момент события
- `recordedAt` (timestamptz) — время точки на устройстве
- `durationSec` (int, nullable, v0.64.0) — у `exit`: сколько ребёнок пробыл в зоне от
  подтверждённого входа; NULL, если вход не наблюдался (начальное состояние)
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

**Логика детекции (v0.64.0, подробно — `docs/superpowers/specs/2026-09-29-geofences-v2.md`):**

1. При приёме точки (в транзакции, под `pg_advisory_xact_lock` по ребёнку) для каждой зоны ребёнка
   считается `d = ST_Distance(center_geo, точка)`. Вердикт с учётом погрешности `acc`:
   внутри, если `d + acc/2 ≤ R`; снаружи, если `d − acc > R + max(30, 0.15R)`; иначе «неясно» —
   состояние и ожидание не трогаются.
2. Вердикт отличается от `isInside` → `pendingTransition = true`, `pendingSince = recordedAt`.
3. Следующая точка с тем же вердиктом через ≥ 60 с по времени фикса → ZoneEvent, новое `isInside`,
   `lastConfirmedChange = recordedAt`; push родителям — после commit транзакции.
4. Строки нет (зона «все дети», новый ребёнок) — первая однозначная точка задаёт состояние без события.
5. При создании зоны, добавлении ребёнка и правке центра или радиуса состояние считается по
   последней хорошей точке ребёнка (без `outlier` и `mock`) — без события.

### `zone_notification_prefs` (v0.65.0)

Личные настройки уведомлений родителя по паре зона × ребёнок. Нет строки — всё включено.

- `userId`, `zoneId`, `childId` — foreign keys (CASCADE)
- `onEntry`, `onExit`, `onMissedArrival` (bool, default true)
- `updatedAt` (timestamptz)

**Уникальность:** `(userId, zoneId, childId)`. **Индекс:** `(zoneId)`.

### `zone_arrival_checks` (v0.65.0)

Проверка «пришёл ли к сроку» — одна на зону, ребёнка и местную дату (идемпотентность
ежеминутного тика `ZoneArrivalService`).

- `zoneId`, `childId` — foreign keys (CASCADE)
- `localDate` (varchar 10) — дата `YYYY-MM-DD` в поясе зоны
- `verdict` (text) — `arrived` | `missed` | `no_data`
- `createdAt` (timestamptz)

**Уникальность:** `(zoneId, childId, localDate)`.

Логика: к сроку + запасу ребёнок внутри зоны (или в ожидании входа) либо входил в неё за местные
сутки до срока — `arrived`; иначе при точке свежее 20 минут — `missed` (событие
`missed_arrival`), иначе — `no_data`. Проверяются только дети с живым устройством; окно
догоняния после срока — 120 минут.

### `zone_place_dismissals` (v0.67.0)

Подсказки мест, которые родитель попросил больше не показывать («Больше не показывать»).
Общие на семью: подсказка любого вида ближе 200 м от сохранённой точки не показывается.

- `familyId` — foreign key на `families` (CASCADE — уходит вместе с семьёй)
- `kind` (varchar 16) — `home` | `school` | `frequent`, вид скрытой подсказки
- `lat`, `lon` (double) — центр скрытого места
- `createdBy` (text) — `userId` родителя
- `createdAt` (timestamptz)

**Индекс:** `(familyId)`.

Сами подсказки и статистика визитов нигде не хранятся: `ZonePlacesService` считает их на
лету по хорошим точкам (`trackFlag IS NULL`) за 30 дней — столько же живут локации.

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

Вне pg_cron: `diag_log_uploads` чистится приложением при каждой загрузке журнала (14 дней, не больше
30 на устройство).

**Каскадное удаление:** при hard-delete пользователя или семьи все связанные записи (дети, devices, локации, зоны, события, согласия) удаляются автоматически через foreign key CASCADE.

---

## Миграции и управление версией схемы

Все миграции хранятся в `apps/backend/prisma/migrations/` в текстовом формате `.sql`. При pull/deploy новых изменений:

```bash
# На dev-машине
pnpm --filter @periscop/backend prisma migrate dev

# На production (автоматически в deploy.sh)
pnpm --filter @periscop/backend prisma migrate deploy
```

Миграции идемпотентны и безопасны для production (используется таблица `_prisma_migrations` для отслеживания версии).

---

## Безопасность и производительность

### Индексы по приоритету

| Приоритет | Таблица         | Индекс                               | Причина                           |
| --------- | --------------- | ------------------------------------ | --------------------------------- |
| P0        | locations       | `(childId, recordedAt DESC)`         | основной запрос истории локаций   |
| P0        | zones           | GIST на `center_geo`                 | геометрия зон (ST_Distance)       |
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
pnpm --filter @periscop/backend prisma studio
```

Откроется интерактивная веб-GUI для просмотра и редактирования данных (только для dev).

---

## Вопросы и контакты

При необходимости изменения схемы — открыть issue в repo или связаться с [link28rus@gmail.com](mailto:link28rus@gmail.com).
