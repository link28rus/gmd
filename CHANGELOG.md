# Changelog

Все значимые изменения проекта GMD фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

Страница «Что нового» в web-кабинете рендерится из этого файла.

---

## [Unreleased]

### Новые возможности
- _здесь копятся фичи следующего релиза_

---

## v0.1.0 — 2026-04-18

### Изменения
- **Монорепо-скелет** — pnpm workspaces + Turborepo для JS/TS, Melos для Flutter
- **Backend** — NestJS 11 skeleton с `/healthz`, Prisma 5 (заглушечная модель User)
- **Web** — Next.js 15 skeleton с landing-заглушкой и `/api/healthz`
- **Mobile** — Flutter-приложения `mobile-parent` (Android+iOS) и `mobile-child` (Android); Dart-пакеты `gmd_parent`, `gmd_child`, `gmd_shared`
- **Пакеты** — `@gmd/shared-types`, `@gmd/ui` (заглушки)
- **Тулинг** — ESLint 9 flat config, Prettier 3, Husky 9 + lint-staged, commitlint (Conventional Commits)
- **fix(ui): `--no-error-on-unmatched-pattern`** — lint-скрипт пакета `@gmd/ui` не падает, если `src/**/*.tsx` пока пуст
- **Дизайн MVP** — см. [spec](docs/superpowers/specs/2026-04-18-gmd-mvp-design.md)
- **CLAUDE.md** — конвенции, скилы, субагенты, процесс

---

<!-- Шаблон записи релиза — раскомментировать при выпуске первой версии

## v0.1.0 — 2026-MM-DD

### Новые возможности
- **Название фичи** — человекочитаемое описание, что даёт пользователю (#PR)

### Улучшения
- **Короткое название** — что стало лучше (#PR)

### Исправления
- fix(scope): краткое описание починенного бага (#PR)

### Изменения
- docs: обновления документации
- refactor: техдолг без влияния на пользователя

-->
