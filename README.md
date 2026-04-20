# GMD

Сервис родительского контроля и геолокации детей (клон «Где мои дети»).

- **Домен:** [gmd.link28rus.ru](https://gmd.link28rus.ru)
- **Документация:** см. [CLAUDE.md](CLAUDE.md) и [docs/](docs/)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## Возможности MVP

- GPS-геолокация детей (Android) + история 30 дней
- Геозоны с автоматической детекцией входа/выхода (до 20 зон на семью, радиус 50–5000 м)
- Web-кабинет родителя с картой и лентой событий
- Система управления детьми через QR-кодом
- Вход по email + OTP-коду или пароль
- Политика конфиденциальности и согласие на обработку данных (152-ФЗ)

## Быстрый старт

```bash
pnpm install
pnpm stack:up     # Postgres + PostGIS, Redis, MinIO, Adminer в docker
pnpm dev          # backend + web параллельно
```

- Backend: http://localhost:3001 (`/healthz`, `/readyz`)
- Web: http://localhost:3000

## Dev-стек в Docker

```bash
pnpm stack:up             # все 4 сервиса
pnpm stack:down           # стоп (volumes остаются)
pnpm stack:reset          # стоп + удаление volumes
pnpm stack:logs
pnpm stack:ps
```

Порты по умолчанию (см. `infra/docker/.env.dev.example`):

- Postgres: `localhost:5432` (user `gmd`, db `gmd_dev`)
- Redis: `localhost:6379`
- MinIO: API `localhost:9000`, Console `localhost:9001` (`minio` / `minio12345`)
- Adminer: http://localhost:8080

Если порты заняты — переопределить в `infra/docker/.env.dev` и согласовать с `apps/backend/.env`.

## Стек

Flutter • Next.js 15 • NestJS • PostgreSQL + PostGIS • Redis • Caddy

Подробности — в [CLAUDE.md](CLAUDE.md).
