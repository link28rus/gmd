# GMD — сервис родительского контроля и геолокации детей. Дизайн MVP.

**Статус:** Draft
**Дата:** 2026-04-18
**Автор:** link28rus + Claude
**Аналог:** gdemoideti.ru («Где мои дети»)

---

## 1. Цель и контекст

Разработать self-hosted сервис геолокации и базового родительского контроля для детей. Модель — клон «Где мои дети» (РФ-рынок, ~2M пользователей у оригинала) с упрощённым скоупом под соло-разработку.

**Целевая аудитория:** родители детей 6–16 лет в РФ.

**Гипотеза ценности:** родитель получает в одном приложении геолокацию ребёнка + уведомления о входе/выходе из геозон (дом/школа) + SOS-кнопку + базовую статистику экранного времени — без необходимости покупать GPS-часы.

## 2. Scope MVP

### В MVP входит

- Регистрация родителя (email/phone + пароль)
- Добавление ребёнка по QR-коду приглашения
- GPS-геолокация ребёнка (Android), история 30 дней
- Геозоны с уведомлениями о входе/выходе
- SOS-кнопка (ребёнок → родитель)
- Read-only статистика экранного времени (Android, через `UsageStatsManager`)
- **«Звук вокруг ребёнка»** — аудиомониторинг окружения по запросу родителя (Android only, видимое уведомление ребёнку, foreground service `microphone`). Детальный дизайн — в отдельном spec'е (TBD).
- Push-уведомления (FCM + RuStore Push fallback)
- Web-кабинет родителя (Next.js)
- Mobile-приложение родителя (Flutter, Android + iOS)
- Mobile-приложение ребёнка (Flutter, **только Android** на MVP)

### Явно НЕ входит в MVP

- Чат родитель↔ребёнок
- GPS-часы (интеграция по MQTT)
- Мобильное приложение ребёнка на iOS (ScreenTime API требует Apple entitlement)
- Мониторинг соцсетей
- Платные подписки и эквайринг
- Партнёрская программа
- Многоязычность (только русский)

## 3. Нефункциональные требования

| Параметр           | Требование                                                 |
| ------------------ | ---------------------------------------------------------- |
| Регион данных      | РФ (152-ФЗ)                                                |
| Хостинг            | Self-hosted, сервер 192.168.1.23, домен `gmd.link28rus.ru` |
| Внешний доступ     | Проброс портов с 85.15.75.126                              |
| История локаций    | 30 дней, автоматическая очистка через `pg_cron`            |
| Push-провайдеры    | FCM + RuStore Push                                         |
| Карты              | Яндекс.Карты                                               |
| Монетизация на MVP | Отсутствует (бесплатно, сбор аудитории)                    |
| TLS                | Caddy + Let's Encrypt                                      |
| Команда            | Соло-разработчик + Claude Code как реализатор              |

## 4. Юридический слой (152-ФЗ)

- Геолокация несовершеннолетних = спецкатегория ПДн → хранение только в РФ ✓
- Модель согласия: родитель регистрируется и сам добавляет ребёнка по QR. Для ребёнка 14+ — отдельное согласие (во флоу claim invite).
- Политика конфиденциальности + версионированное согласие при регистрации (дата + версия фиксируются).
- Право на удаление: `DELETE /me` инициирует soft-delete, hard-delete через 30 дней cron'ом.
- Уведомление Роскомнадзору об обработке ПДн перед публичным запуском.

## 5. Технологический стек

### Mobile

- **Flutter 3.x** (Dart 3) — одна кодовая база на обе платформы
- `yandex_mapkit` — карты (РФ-аудитория)
- `riverpod` — state management (рекомендация; финально фиксируется в plan)
- `dio` + interceptors для HTTP
- `drift` (SQLite) — локальная очередь локаций
- `firebase_messaging` + RuStore Push SDK
- Android: foreground service + `FusedLocationProviderClient`, `UsageStatsManager`

### Web

- **Next.js 15** (App Router, Server Actions) + TypeScript
- Tailwind CSS + **shadcn/ui**
- Zod + react-hook-form
- Playwright (e2e smoke)

### Backend

- **NestJS** (TypeScript) — модульный монолит
- **PostgreSQL 16** + **PostGIS** + **pg_cron**
- **Redis** — сессии, rate-limit, короткий кеш локации
- **MinIO** — S3-совместимое хранилище для аватаров
- REST + OpenAPI 3.1 → codegen TS + Dart клиентов
- JWT access (15 мин) + refresh (30 дней); device-token для детских устройств (long-lived)

### Инфраструктура

- Docker + Docker Compose
- Caddy (reverse proxy + TLS)
- GlitchTip (self-hosted Sentry-совместимый)
- Uptime Kuma + Telegram-бот для алертов
- Grafana + Loki + Prometheus + node_exporter + postgres_exporter
- Dozzle — быстрый web UI для docker logs
- Gitea или GitHub для кода + Actions для CI/CD
- pg_dump + age-шифрование → Yandex Object Storage (ежедневно)

## 6. Архитектура: monorepo

```
gmd/
├── apps/
│   ├── backend/            NestJS API
│   ├── web/                Next.js 15
│   ├── mobile-parent/      Flutter
│   └── mobile-child/       Flutter (Android MVP)
├── packages/
│   ├── shared-types/       TS-типы (OpenAPI codegen)
│   ├── shared-dart/        Dart-модели
│   └── ui/                 shadcn/ui base
├── infra/
│   ├── docker/             docker-compose.{dev,prod}.yml
│   ├── caddy/              Caddyfile
│   └── migrations/
├── docs/superpowers/specs/
├── .taskmaster/
├── .mcp.json
└── CLAUDE.md
```

**Почему модульный монолит:** соло-проект, микросервисы = х5 к DevOps без выигрыша. NestJS-модули (Auth, Family, Location, Geofence, Notification, ScreenTime, SOS) — легко распилить позже.

## 7. Модель данных (ключевые сущности)

```
users(id, email, phone, password_hash, role, created_at)
families(id, owner_id, name)
family_members(family_id, child_device_id, role, added_at)
child_devices(id, family_id, name, avatar_url, platform, app_version,
              battery, last_seen_at, linked_user_id NULL)
locations(id, child_device_id, lat, lng, accuracy_m, speed, battery,
          recorded_at, received_at)  -- retention 30 дней
geofences(id, child_device_id, name, type, geom, notify_on, is_active)  -- PostGIS
geofence_events(id, geofence_id, child_device_id, event, occurred_at)
sos_alerts(id, child_device_id, lat, lng, battery, triggered_at, acknowledged_at)
screen_time_reports(id, child_device_id, date, app_package, app_name,
                    minutes_used, first_used_at, last_used_at)
push_tokens(id, user_id, device_platform, provider, token, created_at)
invites(id, family_id, code, expires_at, used_by_device_id)
```

## 8. Ключевые REST-эндпоинты

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /me
PATCH  /me
DELETE /me

POST   /family/invites
POST   /family/invites/:code/claim
GET    /family/children
POST   /family/children/:id/unlink

POST   /children/:id/locations          batch до 50 точек
GET    /children/:id/locations          ?from=&to=
GET    /children/:id/locations/current

POST   /children/:id/geofences
GET    /children/:id/geofences
PATCH  /geofences/:id
DELETE /geofences/:id
GET    /children/:id/geofence-events

POST   /children/:id/sos
GET    /children/:id/sos
POST   /sos/:id/acknowledge

POST   /children/:id/screen-time
GET    /children/:id/screen-time        ?date=YYYY-MM-DD

POST   /devices/push-tokens
DELETE /devices/push-tokens/:id
```

## 9. Realtime-стратегия

**Short-polling + push вместо WebSocket.** Родитель на экране карты дёргает `/locations/current` каждые 10 сек. Push летит только на события (геофенс, SOS). Для соло-проекта это экономит 2-3 недели на WebSocket-инфраструктуре и переподключениях.

## 10. Обработка ошибок

- Единый JSON: `{ error: { code, message, details? } }`, `code` — строка (`INVALID_INVITE`).
- NestJS `ValidationPipe` whitelist + `class-validator`.
- Rate limiting: `@nestjs/throttler` на auth (5 запросов/мин).
- Flutter: Dio интерсептор → auto-refresh на 401 → retry one time.
- Offline на ребёнке: локации в SQLite, батчем при сети.

## 11. Тестирование (минимум для соло)

- **Backend:** unit для доменной логики (геофенс-детектор, SOS), integration через supertest + testcontainers PG. TDD для нового поведения.
- **Web:** Playwright smoke (регистрация → добавить ребёнка → увидеть карту).
- **Mobile:** виджет-тесты ключевых экранов + 1 integration_test на основной флоу.
- **Coverage не гоняем** — фокус на критичных флоу.

## 12. CI/CD

- GitHub/Gitea Actions: lint + typecheck + test на PR.
- `main` → сборка Docker-образов → push в локальный registry на сервере → `docker compose up -d --force-recreate` через SSH.
- Flutter-релизы вручную до установки CI-воркера (RuStore + Google Play + TestFlight).

## 13. Бэкапы и DR

- `pg_dump` ежедневно 03:00 → age-зашифрованный архив → Yandex Object Storage.
- Ретеншн: 7 daily + 4 weekly + 3 monthly.
- Раз в месяц — тестовый restore на staging.

## 14. Мониторинг

- Метрики — Prometheus + node_exporter + postgres_exporter + Grafana.
- Логи — Loki или Dozzle (на старт).
- Ошибки — GlitchTip (Sentry API-compat).
- Uptime — Uptime Kuma → Telegram-бот.

## 15. Безопасность

- TLS через Caddy + Let's Encrypt для `gmd.link28rus.ru`.
- SSH: выключить PasswordAuth, ключи only, отдельный user `gmd`, fail2ban, UFW (22/80/443).
- Helmet + HSTS + CSP.
- CORS whitelist: `gmd.link28rus.ru` + `localhost` dev.
- Все секреты — только в `.env` (не в git), продовые — через `docker compose` env-файлы на сервере.

## 16. Roadmap (16 недель MVP)

| Фаза              | Неделя | Что                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------ |
| 0. Фундамент      | 1-2    | Server hardening, domain, docker-compose, monorepo, CI, полит.конфиденц  |
| 1. Backend core   | 3-5    | Auth, Family, ChildDevice, Location, OpenAPI codegen                     |
| 2. Geofence + SOS | 6-7    | PostGIS-триггеры, push, RuStore fallback                                 |
| 3. Mobile-child   | 8-10   | QR-claim, foreground service, SOS, UsageStats, release в RuStore         |
| 4. Mobile-parent  | 11-13  | Map, history, geofence CRUD, push, release в RuStore + Play + TestFlight |
| 5. Web-кабинет    | 14-15  | Лендинг SEO, кабинет, Playwright smoke                                   |
| 6. Релиз          | 16     | РКН-уведомление, закрытая бета, публичный запуск                         |

## 17. Риски и митигации

| Риск                                                          | Митигация                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Google Play отклонит из-за политики accessibility/usage stats | На MVP только read-only UsageStats (без блокировки) — в правилах                  |
| Apple ScreenTime entitlement не выдадут                       | iOS-ребёнок не в MVP, фаза 7+                                                     |
| FCM нестабилен на Android без GMS                             | RuStore Push fallback                                                             |
| Фоновая геолокация убивает батарею                            | Interval 30-60 сек, батч раз в 3-5 мин, foreground service с видимой нотификацией |
| Проброс портов с домашнего роутера — нестабильный IP          | Динамический DNS на `gmd.link28rus.ru`, в будущем — перенос на VPS                |
| 152-ФЗ проверки                                               | Политика + согласие + уведомление РКН + хостинг в РФ ✓                            |

## 18. Открытые вопросы (к обсуждению при planning)

- ORM: **Prisma** vs **TypeORM** vs **Drizzle**? Рекомендация — Prisma (лучший DX, хорошо дружит с AI-генерацией).
- Git-хостинг: **GitHub** (приватный репо бесплатно) vs self-hosted **Gitea** на сервере?
- Монорепо-инструмент: **Turborepo** vs **Nx** vs только pnpm workspaces? Рекомендация — Turborepo (лёгкий, подходит для этого размера).
- Flutter state-management: **Riverpod** vs **Bloc**? Рекомендация — Riverpod 2.x.
- Валидация на web: **Zod** vs **Valibot**? Рекомендация — Zod (экосистема больше).
- Регистрация: email или phone (OTP через SMS.ru)? Рекомендация — phone + OTP (российская специфика, ниже трение).

## 19. Критерии готовности MVP

- [ ] Родитель регистрируется, создаёт инвайт, ребёнок сканирует QR и связывается.
- [ ] Ребёнок-Android шлёт локации в фоне ≥ 8 часов без смерти батареи сильнее 15%.
- [ ] Родитель видит ребёнка на карте + историю за 30 дней.
- [ ] Геофенс (≥ 2 штук) шлёт push при входе/выходе.
- [ ] SOS от ребёнка доходит push до родителя < 10 секунд.
- [ ] Статистика экранного времени за вчера доступна в кабинете.
- [ ] Web-лендинг Core Web Vitals — зелёные.
- [ ] Политика конфиденциальности + согласие реализованы.
- [ ] Приложения опубликованы в RuStore (обязательно) + Google Play (internal) + TestFlight.
- [ ] Бэкап PG + тестовый restore отработаны.

---

**Следующий шаг:** `superpowers:writing-plans` → детальный implementation plan для Фазы 0 (Фундамент).
