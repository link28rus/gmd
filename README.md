# GMD

Сервис родительского контроля и геолокации детей (клон «Где мои дети»).

- **Домен:** [gmd.link28rus.ru](https://gmd.link28rus.ru)
- **Документация:** см. [CLAUDE.md](CLAUDE.md) и [docs/](docs/)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## Быстрый старт

```bash
pnpm install
pnpm dev
```

- Backend: http://localhost:3001 (healthcheck: `/healthz`)
- Web: http://localhost:3000

## Стек

Flutter • Next.js 15 • NestJS • PostgreSQL + PostGIS • Redis • Caddy

Подробности — в [CLAUDE.md](CLAUDE.md).
