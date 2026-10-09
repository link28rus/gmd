# Перископ — prod-деплой

Runbook по развёртыванию production-стека Перископ на VPS `45.67.230.87`
(periscop.pro, Ubuntu 24.04 LTS, single iface ens3). Legacy API-зеркало доступно на gmd-online.ru.

## Архитектура

```
Пользователь → 45.67.230.87:{80,443} → [Caddy + Let's Encrypt автоматически]
                                            ├── /api/* → backend:3001 (NestJS)
                                            ├── /audio/ws → backend:3001 (WS)
                                            └── /*     → web:3000     (Next.js)

Внутри docker-сети gmd_net:
  postgres:5432              (основная БД, Postgres 16 + PostGIS + pg_cron)
  redis:6379                 (основной Redis)
  minio:9000                 (audio chunks + avatars)
  backend:3001               (NestJS REST + /audio/ws)
  web:3000                   (Next.js 15 SSR)
  caddy:80/443               (reverse proxy + Let's Encrypt)
  glitchtip-postgres:5432    (GlitchTip — отдельная БД)
  glitchtip-redis:6379       (GlitchTip celery broker)
  glitchtip-web:8000         (error tracking UI + API)
  glitchtip-worker           (celery)
  uptime-kuma:3001           (uptime + алерты)

UFW: только 22/80/443 наружу. Админ-панели GlitchTip/Kuma —
через SSH-туннель (см. docs/monitoring.md).
```

## Prerequisites

- `ssh gmd-online 'echo ok'` возвращает `ok` (ключ в `~/.ssh/config` — см. Task 5 Phase 0.3).
- `/opt/gmd/.env.prod` на сервере заполнен (Task 9).
- Docker CE + compose-plugin установлены (Task 8).
- Образ `gmd-postgres:16-postgis-pgcron` существует на сервере (Task 10) либо собирается при первом deploy.

## Первый деплой

```bash
cd D:/Project/GMD
bash infra/deploy/deploy.sh
```

Первый раз собирает образы с нуля (5–15 минут на 2-ядерной VM + swap 4G).
Последующие вызовы — инкрементально (rsync + cached-build).

Скрипт `deploy.sh` делает:

1. `rsync` исходников (apps, packages, infra, root manifests) в `/opt/gmd/` на сервере.
2. `docker compose build` и `up -d` на сервере.
3. `docker compose exec gmd-backend pnpm --filter @periscop/backend prisma migrate deploy`.
4. `docker compose ps` для проверки, что все сервисы healthy.

## Инкрементальный деплой

Тот же `bash infra/deploy/deploy.sh`. Скрипт идемпотентен: rsync пропускает неизменённые файлы, compose использует cache.

## Rollback

На dev-машине:

```bash
git checkout <prev-sha>
bash infra/deploy/deploy.sh
```

Для выключения стека без rollback:

```bash
ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml down'
```

(историческая заметка: до 2026-05-15 сервис работал на domain gmd-online.ru; миграция на periscop.pro выполнена с сохранением инфра-имён как gmd-\* для стабильности текущих систем. Legacy API-редирект на gmd-online.ru остаётся активным.)

(В Phase 0.4 — реестр образов и deploy по тегу.)

## Проверки после deploy

```bash
# На dev-машине
curl -sS https://periscop.pro/healthz           # Caddy (TODO: directive order)
curl -sS https://periscop.pro/api/readyz        # backend → {"status":"ok","db":"up","redis":"up"}
curl -sSI https://periscop.pro/                 # web → HTTP/1.1 200 OK

# На сервере
ssh gmd-online 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Ожидаем 6+ контейнеров в `Up (healthy)`: `gmd-postgres`, `gmd-redis`, `gmd-minio`, `gmd-backend`, `gmd-web`, `gmd-caddy`.

## Мониторинг

После деплоя stack включает GlitchTip (error tracking) и Uptime Kuma (uptime). Доступ: `ssh -N gmd-online-tunnels` → `http://localhost:3010` и `http://localhost:3011`. Детали — [docs/monitoring.md](monitoring.md).

## «Звук вокруг» — WebSocket-relay (v0.35)

В v0.35 «Звук вокруг» переведён с WebRTC/coturn на серверный WebSocket-relay.
coturn полностью удалён из стека (Phase 4 Plan E pivot, см. CHANGELOG v0.35.0-rc.4).

Backend поднимает WS-эндпоинт на `/audio/ws` (тот же 3001-порт, что и REST API).
Caddy уже проксирует `/audio/ws` через `reverse_proxy` (HTTP/1.1 Upgrade).

### Переменные окружения

```
AUDIO_WS_SECRET=<openssl rand -base64 48>  # ≥32 байт, JWT HS256-ключ
AUDIO_WS_PUBLIC_URL=wss://gmd-online.ru/audio/ws
```

Записать в `/opt/gmd/.env.prod`. Не коммитить.

## Push-уведомления (FCM)

Команды ребёнку идут по своему WebSocket-каналу (`/api/child/ws`, v0.57), FCM для них — запасной
путь. **Родителю другого канала нет**: push о входе/выходе из геозоны и SOS уходят только через FCM
(`FcmService.sendHybridToToken`). Без ключа backend пишет при старте
`FIREBASE_SA_KEY не задан — FCM disabled`, и родитель эти события не получает.

Ключ — service-account JSON Firebase-проекта `gmd-prod-7d1f8` (в нём зарегистрированы
`pro.periscop.parent` и `pro.periscop.child`), в `.env.prod` лежит **base64 одной строкой**.

1. Firebase Console → проект `gmd-prod` → ⚙ Project settings → Service accounts →
   **Generate new private key**. Файл отдаётся один раз; в чат/git не класть.
2. Загрузить на сервер, не выводя содержимое:
   ```bash
   ssh gmd-online 'umask 077; cat > /root/fcm-sa.json' < ~/Downloads/gmd-prod-7d1f8-firebase-adminsdk-*.json
   ```
3. На сервере: `base64 -w0 /root/fcm-sa.json` → значение `FIREBASE_SA_KEY=` в `/opt/gmd/.env.prod`
   (base64 без `$`, кавычки не нужны), затем `shred -u /root/fcm-sa.json`.
4. Пересоздать backend (образ не пересобирается):
   ```bash
   ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d backend'
   ssh gmd-online 'docker logs gmd-backend 2>&1 | grep FcmService'   # FCM initialized (project=gmd-prod-7d1f8)
   ```
5. После проверки доставки — удалить старые ключи сервисного аккаунта (Service accounts →
   Manage service account permissions → `firebase-adminsdk-fbsvc@…` → Keys).

### Известное ограничение: RuStore Push выключен

RuStore на паузе, и канал RuStore Push не работает ни на одном уровне:

- **сборка** — в `apps/mobile-{parent,child}/android/` нет `rustore.properties`, `project_id` в
  манифесте пустой, приложения не получают RuStore-токен (в `parent_devices` их нет);
- **compose** — `docker-compose.prod.yml` не передаёт backend'у `RUSTORE_PUSH_*`, в
  `.env.prod.example` их тоже нет — заданные на сервере значения backend не увидит;
- **ключи** — сервисные токены RuStore Push утеряны вместе со старым VPS;
- **mobile-parent** — RuStore-сообщения принимает только Dart-колбэк в
  `lib/core/push/parent_rustore_push_registrar.dart`, он их лишь логирует: уведомление о геозоне/SOS
  не показывается (FCM-путь рисует его нативно в `ParentFirebaseMessagingService.kt` +
  `GeofenceNotificationText.kt`).

При возврате в RuStore нужно всё сразу: `rustore.properties` в обоих приложениях, проброс
`RUSTORE_PUSH_PROJECT_ID_*` / `RUSTORE_PUSH_SERVICE_TOKEN_*` в compose и `.env.prod.example`, новые
токены из RuStore Console и показ уведомления родителю по тому же рендеру, что у FCM (с учётом, что
плагин `flutter_rustore_push` регистрирует свой сервис сообщений).

## GeoIP — город по IP (v0.64.0)

`GET /api/geo/ip-center` отдаёт центр города по IP клиента — запасной центр карты геозон, когда
у семьи ещё нет зон и точек детей. База локальная, IP никуда не уходит (152-ФЗ).

- **База:** DB-IP City Lite (CC BY 4.0), файлы `dbip-city-ipv4.mmdb` и `dbip-city-ipv6.mmdb`
  (~60–70 МБ каждый) с зеркала GitHub Releases `sapics/ip-location-db`. Официальный сайт DB-IP с
  сервера режется (Cloudflare), MaxMind закрыт для РФ.
- **Где лежит:** на хосте `/opt/gmd/data/geoip/`, в backend — `/srv/geoip` (`:ro`, каталог целиком:
  после замены файла через `mv` bind-mount файла видел бы старый inode). Путь внутри контейнера
  меняется env `GEOIP_DIR`.
- **Обновление:** `gmd-geoip-update.timer` — 3-го числа каждого месяца, 05:15. Скрипт
  `/opt/gmd/bin/geoip-update.sh` качает во временный файл в том же каталоге, проверяет размер и
  маркер MaxMind DB и делает `mv -f`. Backend подхватывает новую базу сам (`watchForUpdates`),
  рестарт не нужен. Лог — `/var/log/gmd-geoip-update.log`.
- **Нет базы** — backend работает, ручка отдаёт `204`, кабинет берёт следующий центр (Москва).
- **Атрибуция:** «IP Geolocation by DB-IP» со ссылкой на db-ip.com — в подписи карты, когда центр
  взят по IP (требование лицензии).

Установка (один раз):

```bash
scp infra/server/bin/geoip-update.sh infra/server/systemd/gmd-geoip-update.{service,timer} gmd-online:/tmp/
ssh gmd-online 'install -m 0755 /tmp/geoip-update.sh /opt/gmd/bin/geoip-update.sh \
  && install -m 0644 /tmp/gmd-geoip-update.service /tmp/gmd-geoip-update.timer /etc/systemd/system/ \
  && systemctl daemon-reload && systemctl enable --now gmd-geoip-update.timer \
  && systemctl start gmd-geoip-update.service && ls -la /opt/gmd/data/geoip'
# база появилась ДО первого старта backend с монтированием — иначе перезапустить backend:
ssh gmd-online 'docker restart gmd-backend && docker logs gmd-backend 2>&1 | grep GeoIP'
```

Проверка: `systemctl list-timers | grep geoip`; в логах backend — `GeoIP: база … загружена`.

## Привязка треков к дорогам — OSRM (v0.80.0)

Backend привязывает треки детей и телефонов родителей к дорогам через два своих `osrm-routed`:
`gmd-osrm-car` (транспорт) и `gmd-osrm-foot` (пешком). Координаты с сервера не уходят (152-ФЗ).
Подробности алгоритма — [spec](superpowers/specs/2026-10-09-road-matching.md).

- **Графы:** `/opt/gmd/osrm/current/{car,foot}` (алгоритм MLD), прежние — в `previous`. Собирает
  `/opt/gmd/bin/osrm-update.sh`: выгрузка Geofabrik «Дальневосточный ФО» (~400 МБ) → `osmium
extract` по прямоугольнику `OSRM_BBOX` (по умолчанию Хабаровск с пригородами,
  `134.3,47.9,136.3,49.2`) → `osrm-extract/partition/customize` для каждого профиля → подмена
  каталога → `docker restart gmd-osrm-*`. Весь регион на 8 ГБ памяти не собрать, поэтому город.
- **Обновление:** `gmd-osrm-update.timer` — 5-го числа, 04:30. Если карта на Geofabrik не
  менялась, сборка пропускается. Лог — `/var/log/gmd-osrm-update.log`. Своё значение `OSRM_BBOX`
  задаётся в `/etc/default/gmd-osrm-update`.
- **Backend:** env `OSRM_CAR_URL` / `OSRM_FOOT_URL` (по умолчанию `http://osrm-{car,foot}:5000`,
  пустое значение выключает привязку). Если OSRM недоступен, треки отдаются без привязки, привязка
  ставится на паузу на минуту, в логе пишется `osrm … unavailable`.
- **Нет графа:** контейнеры OSRM перезапускаются, остальное работает.

Установка (один раз, до первого деплоя с v0.80.0) — `infra/server/systemd/README.md`, раздел
«gmd-osrm-update». Проверка после деплоя:

```bash
ssh gmd-online 'docker ps --format "{{.Names}} {{.Status}}" | grep osrm'
ssh gmd-online 'docker exec gmd-backend wget -qO- "http://osrm-car:5000/route/v1/car/135.07,48.48;135.09,48.47" | head -c 200'
```

## Обновление `.env.prod`

Редактируется только на сервере (в git не коммитится):

```bash
ssh gmd-online 'sudo -e /opt/gmd/.env.prod'
ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d'
```

Если меняем `NEXT_PUBLIC_*` — обязательно `--build web` (переменная запекается в bundle на этапе build).

## Troubleshooting

### `docker compose build` OOM

Swap 4G должен хватить для node-builder. Если всё ещё OOM — увеличить VM RAM или уменьшить `nproc`.

### `pg_isready` не становится healthy

```bash
ssh gmd-online 'docker logs gmd-postgres --tail 50'
```

Частая причина первого запуска — долгое создание PostGIS-расширений (2–3 минуты).

### Prisma `migrate deploy` fails: database not reachable

`docker ps` должен показывать `gmd-postgres` как `healthy`. Если нет — см. выше.

### Caddy не видит переменную из `.env.prod`

`docker compose exec caddy env | grep <VAR>` покажет что фактически пришло в контейнер. Значения с `$` проходят корректно через `--env-file`.

### Next.js показывает `NEXT_PUBLIC_API_URL` из предыдущего билда

`NEXT_PUBLIC_*` переменные запекаются на build-time. После изменения в `.env.prod` пересобрать:

```bash
ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d --build gmd-web'
```

## Файлы

- `infra/deploy/deploy.sh` — сам скрипт.
- `infra/docker/docker-compose.prod.yml` — описание стека.
- `infra/caddy/Caddyfile` — конфиг reverse proxy (HTTP-режим).
- `infra/server-setup/*.sh` — одноразовые скрипты bootstrap/hardening (Tasks 2, 6, 7, 8, 15).
- `/opt/gmd/.env.prod` — секреты (на сервере, 600).
- `/opt/gmd/backups/postgres/` — ежедневные бэкапы PG (Task 15).

## Ключ Яндекс-Геокодера

Карты в кабинете рендерятся через OpenStreetMap (`react-leaflet`) — публичный ключ Яндекса для них **не нужен**. Но серверный `/api/geocode` ходит в **HTTP Геокодер Яндекса** (это отдельный продукт, отдельный лимит). Ключ нужен только для него; работает на server-side, в браузер не попадает. Кто пользуется:

- редактор геозон — поиск по адресу (`?q=…`);
- история передвижений (v0.78.0) — адрес старта/финиша поездки вне геозон (`?reverse=lon,lat`, ближайший дом). Запрашивается только для строк на экране; ответы кэшируются в памяти web-контейнера (до 5000 точек, ключ ~10 м), так что дом/школа не тратят квоту каждый день.

Получить ключ:

1. Открыть https://developer.tech.yandex.ru
2. Войти под yandex-аккаунтом организации.
3. Создать API-ключ для **«HTTP Геокодер»** (JavaScript API не нужен).
4. В кабинете Яндекса ограничить ключ по HTTP Referer. Сервер шлёт Referer из `PUBLIC_SITE_URL` (на проде `https://gmd.link28rus.ru`), поэтому и локально в `apps/web/.env.local` нужен тот же `PUBLIC_SITE_URL`.
5. Положить ключ в `apps/web/.env.local` (dev) или в prod `.env` через `infra/deploy/deploy.sh`:
   ```
   YANDEX_GEOCODER_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

Без ключа `/api/geocode` отвечает `503 geocoder_not_configured`: в редакторе зон поиск по адресу показывает «поиск недоступен», в истории вместо адреса — «точка на карте» — остальная функциональность (drag-маркеры, вёрстка зоны вручную) работает.
