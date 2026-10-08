# Общая карта семьи и геолокация родителей (v0.70.0)

Решения пользователя от 08.10.2026. Прод семейный: 152-ФЗ-доработки (политика, версия
согласия) и iOS не делаем.

## Что видит пользователь

- **Приложение родителя (Android).** Главный экран: сверху карта на ~45% высоты, ниже
  прежний список детей. На карте — все дети (аватар, имя, возраст точки, круг точности,
  метка серая, если точке больше 10 минут), геозоны семьи и метки родителей семьи
  (свой — подпись «Вы»). Нажатие на метку или карточку ребёнка — экран ребёнка.
- **Веб-кабинет.** В боковой панели над детьми пункт «Все» (`?childId=all`) — та же
  карта: дети, родители, зоны. Только просмотр, опрос раз в 30 с.
- **Геолокация родителя в фоне.** Приложение родителя передаёт свой GPS на сервер
  постоянно, как приложение ребёнка, с постоянным уведомлением «Семья видит, где вы».
  Тумблер «Показывать меня семье» в меню (по умолчанию включён). Выключение
  останавливает передачу и удаляет точки родителя с сервера.
  **С v0.73.0 иначе:** передача идёт всегда, тумблер управляет только видимостью для
  семьи, точки не удаляются — см. [«Найти телефон»](2026-10-09-find-parent-phone.md).
- История точек родителя хранится 30 дней (pg_cron), как у детей. Отдельного экрана
  истории родителя пока нет (v0.73.0: маршрут своего телефона — в «Найти телефон»).

## Обновление в реальном времени

Пока карта на главном экране видна и приложение на переднем плане:
`PUT /family/locations/watch` раз в 30 с (отмечает «смотрю» на всех детей семьи разом,
тот же Redis-механизм v0.69.0) + опрос `GET /family/locations/latest` раз в 30 с +
push `LOCATION_UPDATED` по любому ребёнку семьи → обновление с debounce ~1,5 с.
Метки родителей обновляются только опросом (push по родителям не шлём).

## API (backend, NestJS)

Все пути `/api/family/*` и `/api/parent-location/*` Caddy отдаёт прямо в backend —
прокси в Next.js не нужен (`/api/me` — нужен, поэтому флаг вынесен из `/me`).

### Токен геолокации родителя

Нативная служба не может пользоваться JWT родителя: refresh-токен ротируется, а
повтор старого после 10 с отзывает все сессии пользователя. Поэтому — отдельный
долгоживущий токен, как device-token ребёнка (sha256 в БД, `randomBytes(32)` base64url).

- `POST /parent-location/devices` — JWT. Тело `{ platform?: string, appVersion?: string,
replaceDeviceId?: string }`. Создаёт устройство, возвращает `201 { deviceId, token }`.
  `replaceDeviceId` (своё же устройство) — отозвать старое.
- `DELETE /parent-location/devices/:deviceId` — JWT, только своё. `204`. Вызывается при
  выходе из аккаунта.
- `POST /parent-location/points` — заголовок `X-Parent-Location-Token`. Тело
  `{ points: [{ lat, lon, recordedAt (ISO), accuracy?, speed?, bearing?, batteryLevel?,
isCharging?, provider?, isMock? }] }`, до 500 точек (больше — 413 `batch_too_large`),
  strict zod. Троттлинг 20 запросов/мин. Окно времени как у детей (−7 сут … +2 мин),
  точки с accuracy > 500 м отбрасываются. `INSERT … ON CONFLICT (deviceId, recordedAt)
DO NOTHING`. Обновляет `lastSeenAt` устройства.
  Ответ `200 { accepted, rejected, sharingDisabled }`. Если у пользователя флаг выключен —
  ничего не пишет, `sharingDisabled: true` (клиент останавливает службу).
  Токен отозван / неизвестен / пользователь удалён — `401` (клиент останавливает службу
  и стирает токен).

### Флаг видимости

- `GET /parent-location/sharing` — JWT → `{ enabled: boolean }`.
- `PUT /parent-location/sharing` — JWT, тело `{ enabled: boolean }` → `{ enabled }`.
  `false` → в одной транзакции флаг + `deleteMany` точек пользователя.

### Общая карта

- `GET /family/locations/latest` — ответ расширяется ключом `parents`, `items` не меняется
  (обратная совместимость со старыми клиентами):
  `{ items: [...как было], parents: [{ userId, name, lat, lon, accuracy, recordedAt,
ageSec, isMe }] }`. Родители — члены семьи (memberships), не удалённые, с включённым
  флагом, последняя точка без `isMock`, не старше 30 дней. `name` — `user.name` →
  `firstName` → часть email до `@`.
- `PUT /family/locations/watch` — JWT → `204`. Отметка «смотрю» на всех неудалённых
  детей семьи.

### Данные (Prisma)

- `User.shareLocationWithFamily Boolean @default(true)`.
- `ParentLocationDevice` (`parent_location_devices`): `id`, `userId` → users (Cascade),
  `tokenHash @unique`, `platform?`, `appVersion?`, `createdAt`, `lastSeenAt?`,
  `revokedAt?`; `@@index([userId])`.
- `ParentLocation` (`parent_locations`): `id`, `userId` → users (Cascade), `deviceId` →
  parent_location_devices (Cascade), `lat`, `lon`, `accuracy?`, `speed?`, `bearing?`,
  `batteryLevel?`, `isCharging?`, `provider?`, `isMock Boolean @default(false)`,
  `recordedAt`, `serverReceivedAt @default(now())`;
  `@@unique([deviceId, recordedAt])`, `@@index([userId, recordedAt(sort: Desc)])`.
- Миграция `20261008120000_parent_locations` + pg_cron `parent-locations-retention-daily`
  (`0 3 * * *`, 30 дней) по образцу `20260419050145_add_locations`.

## Приложение родителя: фоновая служба (Kotlin)

Повторяет устройство `LocationForegroundService` ребёнка в минимальном объёме.

- `ParentLocationService` — FGS `foregroundServiceType="location"`, `START_STICKY`,
  идемпотентный `start()` с проверкой разрешения (иначе SecurityException на 14+),
  `onTaskRemoved` → alarm-перезапуск через 3 с.
- Fused Location: `PRIORITY_BALANCED_POWER_ACCURACY`, интервал 60 с, min интервал 30 с,
  min смещение 50 м; точки с accuracy > 100 м отбрасываются.
- Отправка нативным `HttpURLConnection` (без Flutter-изолята): буфер до 500 точек в
  SharedPreferences, отправка пачкой не чаще раза в 60 с (первая точка — сразу),
  backoff 30 с → 5 мин при сети/5xx/429; 401 → стоп + стереть токен; `sharingDisabled`
  → стоп.
- Сторож: периодический WorkManager (15 мин) вызывает `ensureStarted`; ресивер
  `BOOT_COMPLETED` / `QUICKBOOT_POWERON` / `MY_PACKAGE_REPLACED` запускает службу, если
  есть токен, флаг включён и выдано разрешение.
- Креды (`baseUrl`, `token`, `deviceId`, `enabled`) — в отдельных SharedPreferences,
  пишет Dart через MethodChannel `pro.periscop.parent/location`
  (`saveCreds`, `clearCreds`, `start`, `stop`, `status`).
- Манифест: FINE, COARSE, BACKGROUND_LOCATION, FOREGROUND_SERVICE,
  FOREGROUND_SERVICE_LOCATION, RECEIVE_BOOT_COMPLETED, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
  POST_NOTIFICATIONS. Удаление `FOREGROUND_SERVICE_LOCATION` (`tools:node="remove"`)
  снимается; сервис geolocator по-прежнему убираем.
- Уведомление: канал «Перископ — моё местоположение», IMPORTANCE_LOW, текст
  «Семья видит, где вы», своя монохромная иконка.

Dart: при входе / старте приложения, если флаг включён и разрешения выданы — получить
токен (если нет), передать нативу, запустить службу. На главном экране, пока чего-то не
хватает, — карточка «Показывать вас семье» с шагами: геолокация → «Разрешить всегда»
(настройки, перепроверка на resume) → уведомления → без ограничений батареи. Выход —
стоп службы, `DELETE` устройства, стереть креды.

## Не делаем

iOS, история перемещений родителя, push по точкам родителей, метка родителя на картах
геозон и экране ребёнка (только общая карта), изменения политики конфиденциальности.
