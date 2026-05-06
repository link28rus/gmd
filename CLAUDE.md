# GMD — сервис родительского контроля и геолокации детей

Аналог gdemoideti.ru («Где мои дети»), self-hosted, РФ-рынок.
Дизайн MVP: [docs/superpowers/specs/2026-04-18-gmd-mvp-design.md](docs/superpowers/specs/2026-04-18-gmd-mvp-design.md).

## Кратко

Родитель в одном приложении получает:

- GPS-геолокацию ребёнка (Android) + историю 30 дней
- Геозоны с push при входе/выходе
- SOS-кнопка от ребёнка
- Read-only статистика экранного времени Android
- **«Звук вокруг ребёнка»** — аудиомониторинг окружения с устройства ребёнка по запросу родителя (Android only). Аналог фичи «Где мои дети».
- Web-кабинет + мобильные приложения родителя (Android + iOS)

Что в MVP **не делаем**: GPS-часы, чат, iOS-приложение ребёнка, мониторинг соцсетей, платные подписки.

## Технологический стек

| Слой     | Технология                                                                              |
| -------- | --------------------------------------------------------------------------------------- |
| Mobile   | Flutter 3.x, Riverpod, Dio, Drift, flutter_map (OSM), firebase_messaging + RuStore Push |
| Web      | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Zod                           |
| Backend  | NestJS, PostgreSQL 16 + PostGIS + pg_cron, Redis, MinIO                                 |
| API      | REST + OpenAPI 3.1, codegen TS + Dart                                                   |
| Auth     | JWT (access 15m + refresh 30d) + long-lived device-token для детей                      |
| Realtime | Short-polling + FCM/RuStore push (без WebSocket на MVP)                                 |
| Infra    | Docker Compose, Caddy, GlitchTip, Uptime Kuma, Grafana+Loki+Prometheus                  |
| Карты    | OpenStreetMap (mobile: `flutter_map`, web: `react-leaflet`)                             |
| Оплаты   | ❌ на MVP (монетизация после сбора аудитории)                                           |

## Монорепо

```
apps/backend    NestJS API
apps/web        Next.js 15 (лендинг + кабинет)
apps/mobile-parent   Flutter (Android + iOS)
apps/mobile-child    Flutter (Android only на MVP)
packages/shared-types   TS из OpenAPI
packages/shared-dart    Dart из OpenAPI
packages/ui             shadcn/ui base
infra/docker            docker-compose.{dev,prod}.yml
infra/caddy             Caddyfile
docs/superpowers/specs  design docs
```

Менеджер: **pnpm workspaces + Turborepo** (JS/TS), **Melos** (Flutter).

## Инфраструктура

- **Сервер:** ровно два сетевых интерфейса, других IP нет:
  - `ens160` = **192.168.1.23/24** (LAN, default-route через 192.168.1.1, через него идёт SSH из локалки)
  - `ens192` = **95.104.240.111/27** (внешний, прямо у провайдера без NAT-роутера, шлюз 95.104.240.97)
  - Служебное на сервере: loopback (127.0.0.1) и docker bridges (172.17.0.0/16, 172.18.0.0/16) — виртуальные сети контейнеров, не трогать.
  - Asymmetric routing для входящего на ens192 — починен через CONNMARK fwmark 0x2 + ip rule в netplan + iptables-persistent. Runbook в memory-compiler «Asymmetric routing fix на gmd-prod (multi-WAN)».
- **Домен:** gmd.link28rus.ru
- **Регион данных:** РФ (152-ФЗ)
- **SSH credentials:** см. memory-compiler (secret). TODO: перейти на SSH-ключи, отключить password auth.
- **Мониторинг:** GlitchTip + Uptime Kuma (docs/monitoring.md). Доступ через SSH-tunnel `ssh -N gmd-prod-tunnels`.

## 152-ФЗ и приватность

- Хранение ПДн только в РФ ✓
- Политика конфиденциальности + версионированное согласие при регистрации
- `DELETE /me` → soft-delete → hard-delete через 30 дней
- Retention локаций: 30 дней (pg_cron)
- Модель согласия: родитель добавляет ребёнка по QR. Для 14+ — отдельное согласие в claim invite.
- Уведомление Роскомнадзору перед публичным запуском

## Рабочий процесс

**Superpowers-скилы (`superpowers:*`) используются ТОЛЬКО по явному запросу пользователя.**
По умолчанию работаем напрямую: читаем код, правим, проверяем, коммитим. Не вызывать `brainstorming`, `writing-plans`, `executing-plans`, `TDD`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review` и прочие `superpowers:*` пока пользователь не попросит конкретный скил или общий режим «используй superpowers».

**Что остаётся обязательным всегда (без superpowers):**

1. Перед действием — подтянуть контекст из memory-compiler (`start_task` / `search` / `get_active_context`).
2. **Все нетривиальные задачи — через `gmd-taskmaster`.** Любая фича/баг/рефакторинг/деплой = задача в `.taskmaster/tasks/tasks.json`. ПЕРВЫМ действием — `mcp__gmd-taskmaster__next_task` (если работаем по плану) или `mcp__gmd-taskmaster__add_task` (если задача новая, не в плане). В процессе — `set_task_status in-progress` → `update_subtask` (логировать факты) → `set_task_status done`. **Исключения** (без задачи): однострочный typo-fix, опечатка в README, `git push` уже готовых коммитов, ответ на вопрос пользователя без правок кода. Подробности: skill `gmd-development` + `.taskmaster/CLAUDE.md`.
3. После нетривиальной задачи — `finish_task` в memory-compiler + при необходимости `save_decision` / `save_runbook` / `save_tracking`.
4. Перед коммитом — реально запустить то, что менял, и убедиться что работает (без формального скила verification).
5. Документация и CHANGELOG обновляются в том же коммите (см. раздел ниже).
6. **НЕ работать в worktree.** Все правки кода — только в основном чекауте `D:/Project/GMD/`. Если харнесс автоматически запустил тебя в `.claude/worktrees/<name>/` — игнорируй worktree-cwd и оперируй абсолютными путями к основному репо: `Read`/`Edit`/`Write` `D:/Project/GMD/...`, `Bash` команды через `cd D:/Project/GMD && ...`. **Причина:** в worktree не попадает untracked-работа пользователя (новые файлы, незакоммиченные правки), из-за чего ты будешь видеть «фантомные заглушки» там, где фича уже реализована в working tree основного репо. Если хочется изоляции — заведи feature-branch в основном чекауте, а не worktree.

**Best-practices (уроки из прошлых сессий — НЕ повторять):**

1. **Не доверять одному негативному сигналу при поиске инструмента.** `which foo` / `command -v foo` на Windows в git-bash НЕ даёт окончательный ответ «тула нет» — SDK часто лежат на `D:\` / `C:\` вне user PATH. Перед любым workaround (docker-image, пересборка окружения, замена тулинга) — сначала `powershell.exe -Command "Get-ChildItem -Path C:\,D:\ -Filter '<tool>.bat' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 3"` (5-15 сек) или прочитать `CLAUDE.md` / runbook'и. Пути известных SDK — в разделе «Локальное окружение (Windows, git-bash)» ниже.
2. **Память проекта — первый источник истины, не последний.** Если задача похожа на уже решавшуюся (версии растут → значит раньше собирали APK → Flutter где-то был) — искать runbook / lesson / snippets ДО экспериментов. `search_snippets` часто даёт точную команду.
3. **Спрашивать пользователя дешевле экспериментов.** Вопрос «У тебя Flutter установлен? Где?» стоит 10 секунд. Docker-workaround стоит 15 минут + риск новых багов (pubspec_overrides.yaml backslash, fat-apk вместо split-per-abi). Эскалация в heavy-tool — только когда light-варианты исчерпаны.
4. **Ошибка должна оставлять след.** Не повторять одну и ту же ошибку дважды. Каждый раз когда наступил на грабли — обновлять CLAUDE.md и memory-compiler, чтобы следующая сессия стартовала с правильным знанием. Без этого «выучил урок» = не выучил.
5. **Verification = запустить, а не «выглядит правильно».** Typecheck + lint + юнит-тесты ≠ проверка фичи. Для mobile-child перед релизом — реально установить APK и проверить на устройстве. Для backend/web — реально дёрнуть endpoint. Если не можешь проверить (нет устройства, нет ключа API) — честно это сказать пользователю, не маскировать под «готово».
6. **Лог/repro-артефакт раньше кода.** Когда пользователь жалуется на security-критичный или state-зависимый баг — ПЕРВЫМ ДЕЙСТВИЕМ попросить DiagLog / screenshot / шаги воспроизведения. 10 секунд запроса экономят 30+ минут неправильного дебага. В v0.29.2 я сразу начал реверс-инжинирить «PIN-lock issue», а лог потом показал `setProtectionCache:false` (тумблер OFF, не PIN) — v0.29.2 был не нужен. mobile-child: DiagLog доступен через `/debug` экран (long-press на версии в header).
7. **Не трогать то, что не просили.** Задача «убрать X» = снять ТОЛЬКО X, не Y в том же файле/widget'е. Перед массовым удалением — grep по callers/references и спросить «это реально ТОЛЬКО про X?». В v0.29.2 снёс Xiaomi restricted-settings wizard вместе с a11y wizard (общий файл), пришлось восстанавливать в v0.29.3.
8. **Backend-state ≠ device-state.** Для фич с permissions/Device Admin/special settings держать в UI ДВА индикатора: «включено в кабинете (server flag)» И «работает на устройстве (local permission)». Шаблон `(server_flag, local_permission) → UI {on/off/misconfigured}`. v0.29.0 переключал только `Child.protectionEnabled` — на устройстве Device Admin мог быть неактивен, «защита включена» но launcher удалял app. v0.29.4 решил через persistent 🔒/🔓 indicator.
9. **Android OEM ≠ stock.** Special permissions (Device Admin, Accessibility, Notification Listener, VPN, SYSTEM_ALERT_WINDOW, Usage Stats) активируются по-разному на MIUI/HyperOS/OneUI/etc. MIUI/HyperOS 2+ «Ограниченные настройки» блокируют sideload-APK для a11y и Device Admin — нужен wizard с инструкцией «карточка приложения → ⋮ → Разрешить ограниченные настройки». MIUI App Info имеет combined кнопку «Отключить и удалить» — системный bypass Device Admin, недоступен без AccessibilityService. OEM-специфичный flow = обязательный элемент design'а, не edge-case.
10. **UX invisible state = UX disaster.** Если internal state влияет на пользовательский опыт, ДОЛЖЕН быть визуально отображён. Особенно security-критично. В v0.29.0–v0.29.3 состояние защиты было только в DiagLog — пользователь думал «тумблер ON», а было OFF, удалил app, прислал false-alarm bug. v0.29.4 persistent status tile (🔒 зелёный / 🔓 серый / 🔓 красная плашка) решил. Шаблон: для любой фичи с permissions/server-flags — always-visible status tile на главном экране.
11. **«Как у конкурентов» — вместе с их ограничениями.** При задаче «сделай как Pingo / Где мои дети» изучить их платформо-специфичные ограничения, а не только happy-path. Они скорее всего приняли те же trade-offs — воспроизводить полностью, включая known limitations. Не имитировать полную защиту когда базовая технология её не даёт (protection theatre хуже честной защиты с документированным ограничением).
12. **APK install на устройство пользователя — только после проверки подписи.** `flutter install` ВНУТРИ делает `adb uninstall` если подписи различаются → **сносит локальные данные пользователя** (refresh-токены, кэш, настройки). Никогда не использовать `flutter install` на чужом устройстве. Только: (а) `flutter build apk` + `apksigner verify --print-certs` нового APK + `adb shell dumpsys package <id> | grep signatures` сравнить SHA-1; (б) если совпадает — `adb install -r` (reinstall без uninstall, без data loss); (в) если разные — СПРОСИТЬ пользователя, не делать install автоматом. Override versionCode без правки pubspec: `flutter build apk --build-number=N`. Для downgrade: `adb install -r -d`. **Инцидент 2026-05-06:** не проверил подпись → flutter install сделал uninstall → данные снеслись.
13. **Не доверять taskmaster-статусам — проверять реальное состояние.** taskmaster может показывать pending для давно сделанной задачи. Перед `set_task_status in-progress` — короткая разведка через Glob/Grep по описанным файлам/функциям. Если фича уже в коде — пометить done и взять следующую, не дублировать работу.
14. **APK naming — pubspec build, не effective.** В именах `gmd-{child,parent}-X.Y.Z+N-<abi>.apk` число N после `+` — это **pubspec build** (то что в `version: X.Y.Z+N`), а НЕ effective versionCode (с ABI offset). Backend [route.ts](apps/web/app/api/public/updates/mobile-{child,parent}/latest/route.ts) парсит regex'ом из [lib/downloads/index.ts:21](apps/web/lib/downloads/index.ts:21) и сам формирует `effectiveBuild = ABI_VERSION[abi]*1000 + pubspecBuild` для сравнения с `PackageInfo.buildNumber` устройства. Если положить в имя effective — endpoint вернёт `effectiveBuild = ABI*1000 + effective`, что всегда больше реального. **Старые v0.46.5 parent APK на проде имели в имени `+2021` (effective)** — это была inconsistency, прокатывавшая только потому что у parent не было auto-update. После v0.47.0 — auto-update появился, convention обязательно pubspec build (как у child). При публикации не путать.
15. **memory-compiler `finish_task` агрессивно обновляет tracking.** Экстрактор фактов сканирует `content` на IP/URL/версии и подменяет поля в tracking-сущностях (release, infrastructure, deployment). В сессии v0.47.0 я упомянул IP adb-устройства `192.168.77.154` — экстрактор переписал ВСЕ 9 полей `tracking/infrastructure` (server_lan_ip, \_iface, \_gateway, \_domain, …) на это значение. **Mitigation:** (а) перед `finish_task` критически фильтровать `content` — упоминать чужие IP/URL только когда необходимо, либо явно маркировать `adb-устройство 192.168.x.x (НЕ сервер)`; (б) после `finish_task` для нетривиальных задач — `get_current entity=infrastructure` и сверка с CLAUDE.md, восстановить через `save_tracking` если повредилось.
16. **Релиз web + APK — два независимых шага.** Endpoint `/api/public/updates/<app>/latest` работает только когда сделаны ОБА: (а) `bash infra/deploy/deploy.sh` пересобрал `gmd-web` контейнер с новым route, (б) APK с правильным именем лежит в `/opt/gmd/download/`. Забыл deploy → endpoint 404 (route ещё не задеплоен). Забыл APK → endpoint 204 (нет файла под фильтр). Verify обязательно после публикации: `ssh gmd-prod 'curl -sSk --resolve gmd.link28rus.ru:443:127.0.0.1 https://gmd.link28rus.ru/api/public/updates/mobile-{child,parent}/latest?abi=arm64-v8a'` → корректный JSON с {version, buildNumber, url}.

**Рекомендованный порядок при ручной работе:**

1. Понять задачу → подтянуть контекст из памяти.
2. Почитать релевантный код → спланировать изменения (в голове или кратко в чате).
3. Внести правки → прогнать локально (build/lint/typecheck/тесты по ситуации).
4. Обновить доки/CHANGELOG → коммит с понятным сообщением.
5. `finish_task` в memory-compiler.

Если пользователь просит «используй brainstorming», «спланируй через writing-plans», «сделай TDD», «проведи code-review» — тогда включаем соответствующий `superpowers:*` скил.

## Скилы для GMD

### Используем регулярно

- `memory-autopilot` — всегда, контекст между сессиями
- `gmd-development` — проект, пути, конвенции, dev/prod-команды, common mistakes (auto-load для GMD)
- `superpowers:*` — **только по явному запросу пользователя** (см. «Рабочий процесс»)
- `frontend-design:frontend-design` — UI кабинета родителя, лендинг
- `design:design-system`, `design:accessibility-review`, `design:ux-copy`, `design:design-handoff`
- `chrome-devtools-mcp:chrome-devtools`, `chrome-devtools-mcp:a11y-debugging`, `chrome-devtools-mcp:debug-optimize-lcp`
- `webapp-testing` — Playwright smoke web-кабинета
- `browser-tools` — скриншоты для дизайн-итераций
- `doc-coauthoring` — политика конфиденциальности, EULA, РКН-уведомление
- `anthropic-skills:docx`, `anthropic-skills:pdf` — юр. документы
- `update-config` — хуки, permissions, env

### Нужно создать (через `anthropic-skills:skill-creator`)

- `gmd-docker-ops` — compose up/down/logs/exec на 192.168.1.23
- `gmd-db-backup` — pg_dump + restore + anonymize для dev
- `gmd-deploy` — SSH-деплой + healthcheck
- `gmd-mobile-flutter` — Flutter-конвенции, melos, codegen, релиз-процесс
- `gmd-ssh` — SSH на сервер с учётом проброса + non-root user
- `gmd-152fz-compliance` — чеклист при добавлении новых данных/эндпоинтов

## Субагенты

**Принцип:** делегируй субагенту только когда задача >100 строк / >2 файлов / требует узкой экспертизы. Простые правки (CRUD-эндпоинт, одна страница, typo, bump версии) делаем сами в основном потоке — спавн субагента стоит времени и отъедает контекст.

| Задача                                              | Агент                                                                                                                                | Когда НЕ использовать                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| NestJS-модули, бизнес-логика                        | `backend-developer`                                                                                                                  | Тривиальный CRUD-endpoint в одном файле — пишем сами                         |
| Фичи backend+web вместе (endpoint + UI кабинета)    | `fullstack-developer`                                                                                                                | Если фича чисто на одном слое — берём `backend-developer`/`nextjs-developer` |
| REST/OpenAPI design                                 | `api-designer`                                                                                                                       | Добавление одного endpoint в существующий контроллер                         |
| Next.js 15, кабинет, лендинг                        | `nextjs-developer`                                                                                                                   | Правка текста/стиля в существующем компоненте                                |
| Сложные React-хуки, оптимизация рендеров            | `react-specialist`                                                                                                                   | Обычная страница без проблем с perf — `nextjs-developer`                     |
| Сложные TS-типы, codegen                            | `typescript-pro`                                                                                                                     | Обычная типизация props/responses                                            |
| PG-настройки, индексы, PostGIS, pg_cron             | `database-administrator` + `sql-pro`                                                                                                 | Простая Prisma-миграция (add column, rename) — пишем сами                    |
| Геозоны, геофенсинг (PostGIS-геометрия + OSM-карты) | `database-administrator`+`sql-pro` (бэк) / `nextjs-developer` (web `react-leaflet`) / `gmd-flutter-developer` (mobile `flutter_map`) | Точечная правка стиля маркера/полигона                                       |
| Bottlenecks: queries, polling, render perf          | `performance-engineer`                                                                                                               | Пока нет измеренной проблемы — не оптимизируем заранее                       |
| Крупный рефакторинг легаси (3+ модуля)              | `refactoring-specialist`                                                                                                             | Локальный рефакторинг одного файла                                           |
| OpenAPI / публичные API doc                         | `documentation-engineer`                                                                                                             | README, CHANGELOG — пишем сами (см. правила документации ниже)               |
| Dockerfile, compose                                 | `docker-expert`                                                                                                                      | Bump образа, добавление env-переменной                                       |
| CI/CD, Caddy, бэкапы                                | `devops-engineer` / `deployment-engineer`                                                                                            | Правка одной строки в Caddyfile/workflow                                     |
| OWASP, pentests, security-аудит                     | `security-auditor`                                                                                                                   | Code review крупной фичи — у него есть `code-reviewer`                       |
| 152-ФЗ compliance: PII retention, согласия, РКН     | `security-auditor`                                                                                                                   | Уже задокументированный flow без новых данных                                |
| Перед merge крупной фичи                            | `code-reviewer`                                                                                                                      | Свои мелкие коммиты — review не нужен                                        |
| Playwright, supertest, integration_test             | `test-automator`                                                                                                                     | Один unit-тест к существующему сьюту                                         |
| Диагностика бага с неочевидным root-cause           | `debugger`                                                                                                                           | Понятный stack trace — фиксим сами                                           |
| Flutter 3.x, Riverpod, Drift, flutter_map, RuStore  | `gmd-flutter-developer` (кастомный, см. `.claude/agents/`)                                                                           | Правка одного widget'а / bump pubspec — основной поток                       |
| Branching, релизные ветки, merge-конфликты          | `git-workflow-manager`                                                                                                               | Пока работаем в master-only — не нужен                                       |
| Визуальный дизайн UI кабинета (макеты, не вёрстка)  | `ui-designer`                                                                                                                        | Готовый макет → реализация в shadcn — это `nextjs-developer`                 |
| Настройка hooks, MCP, Claude Code settings          | `claude-code-guide`                                                                                                                  | Простой вопрос «как X в Claude» — отвечаем сами                              |
| Исследования по кодбазе (>3 запросов)               | `Explore`                                                                                                                            | Точечный grep/glob — делаем сами через Grep/Glob                             |
| Планирование крупных изменений                      | `Plan`                                                                                                                               | Понятная задача с очевидным планом                                           |

## MCP-серверы

- ✅ `memory-compiler` — контекст проекта, решения, секреты
- ✅ `gmd-taskmaster` — задачи/PRD
- ✅ `filesystem`
- ✅ `chrome-devtools-mcp`, `playwright` — отладка и тесты web
- ✅ `shadcn-ui` — компоненты
- ⏳ Добавить: `postgres` MCP (прямые запросы при отладке), `github`/`gitea` MCP (после выбора git-хостинга)

## Открытые вопросы (решить в writing-plans)

1. ~~ORM~~ → **Prisma** (зафиксировано, Phase 0.2)
2. Git: GitHub приватный vs self-hosted Gitea
3. State-management Flutter: **Riverpod** (рекомендация) vs Bloc
4. ~~Регистрация: email vs phone + OTP~~ → **email + OTP** (реализовано в Phase 1.1, см. [docs/superpowers/specs/2026-04-18-gmd-phase1.1-auth-design.md](docs/superpowers/specs/2026-04-18-gmd-phase1.1-auth-design.md))

## Документация и CHANGELOG (обязательно)

### Правило №1: документация всегда актуальна

После любой фичи/багфикса/изменения API/конфига — обновить соответствующую документацию **в том же коммите**:

- **API меняется** → обновить OpenAPI-spec + regenerate клиенты
- **Модель данных меняется** → обновить `docs/database.md` (ERD + описание таблиц)
- **Архитектурное решение** → `docs/superpowers/specs/YYYY-MM-DD-<topic>.md` + запись в memory-compiler (`save_decision`)
- **Процесс/команды** → обновить этот CLAUDE.md
- **User-facing фича** → обновить CHANGELOG (см. ниже) + user-guide если есть

«Задокументирую потом» = не задокументирую. Либо в том же коммите, либо PR не мержится.

### Правило №2: CHANGELOG — по SemVer и конвенции

Формат — как в NiksDesk (ориентир). Файл: [CHANGELOG.md](CHANGELOG.md) в корне. Дополнительно — страница **«Что нового»** в web-кабинете родителя (рендерится из CHANGELOG.md).

**Структура записи:**

```markdown
## v1.3.50 — 2026-04-15

### Новые возможности

- **Название фичи кратко** — человекочитаемое описание, что это даёт пользователю (#123)

### Улучшения

- **Короткое название** — что стало лучше и почему это важно (#124)

### Исправления

- fix(scope): краткое описание починенного бага (#125)

### Изменения

- docs: что-то по документации
- refactor: техдолг без влияния на пользователя
```

**Правила:**

- **SemVer:** MAJOR.MINOR.PATCH. Breaking → MAJOR, фича → MINOR, fix/docs → PATCH.
- **Conventional Commits** для исправлений/техчейнджей: `fix(scope):`, `docs:`, `refactor:`, `chore:`.
- **Для пользовательских фич** — человеческие заголовки жирным + объяснение через em-dash (`—`). Не `feat(auth): add login` а `**Вход по номеру телефона** — быстрая авторизация без email`.
- **Ссылка на issue/PR** в конце строки: `(#257)`.
- **Дата релиза** — YYYY-MM-DD в заголовке версии.
- **Текущая версия** — верхняя запись, маркируется меткой «Текущая» в UI (в файле — просто первая).
- Каждая версия — отдельный релиз в git (`v1.3.50` тег + GitHub release).
- **Автообновление:** скрипт/CI обновляет CHANGELOG при создании релиза (аналог v1.3.47 NiksDesk). В Фазе 0 закладываем.

**Категории (в порядке убывания важности):**

1. `### Новые возможности`
2. `### Улучшения`
3. `### Исправления`
4. `### Изменения` (docs/refactor/chore — без заметного влияния)
5. `### Breaking changes` (если были — ставим первыми!)

**Где выводить:**

- Web-кабинет → страница `/changelog` (вёрстка как в скриншоте NiksDesk — карточки, версия + дата + badge «Текущая»).
- Mobile-parent → экран «О приложении → Что нового» с той же информацией.
- Версия приложения — всегда видна в sidebar web и на экране «О приложении» mobile.

### Правило №3: единый источник версии

**Source of truth — корневой [package.json](package.json), поле `version`.** Все производные версии (`apps/*/package.json`, `mobile-*/pubspec.yaml` часть X.Y.Z, Sentry release, версия в UI кабинета) выводятся из него через `pnpm version:sync` ([scripts/sync-version.mjs](scripts/sync-version.mjs)).

**Flutter build numbers (`+N`)** — инкрементируются независимо перед каждой сборкой APK (`versionCode` обязан монотонно расти для RuStore). `version:sync` обновляет только X.Y.Z, `+N` сохраняется.

**Релизный workflow:**

```bash
# 1. Обновить CHANGELOG.md — добавить блок ## vX.Y.Z сверху
# 2. Bump корневой package.json (вручную или через npm version)
npm version X.Y.Z --no-git-tag-version --workspaces=false

# 3. Распространить в apps
pnpm version:sync

# 4. Валидация
pnpm version:check

# 5. Если релизим mobile — bump build number (+N) отдельно

# 6. Коммит + тег
git add -A && git commit -m "chore: release vX.Y.Z" && git tag vX.Y.Z
```

**Проверки:**

- `pnpm version:check` — локально, pre-commit hook, и CI workflow [.github/workflows/version-check.yml](.github/workflows/version-check.yml).
- Падает при: рассинхроне `*/package.json`, pubspec X.Y.Z ≠ root, верхний `## vX.Y.Z` в CHANGELOG ≠ root, возврате `apps/web/lib/version.ts`.

**Запрещено:** править версию в одном файле в обход `pnpm version:sync`; возвращать `apps/web/lib/version.ts` (удалён — UI читает `process.env.APP_VERSION`, пробрасывается через `next.config.ts`).

## Команды (dev)

### Локальное окружение (Windows, git-bash)

**Важно для Claude Code:** SDK установлены на диске, но НЕ в `$PATH` git-bash. `which <tool>` даст false negative. Абсолютные пути:

- `flutter` / `dart` → `D:\flutter\bin\flutter.bat` (для bash: `/d/flutter/bin/flutter`). Перед работой с mobile-\* — `export PATH="/d/flutter/bin:$PATH"`.
- `pnpm` → `C:\Users\link2\AppData\Roaming\npm\pnpm.cmd`. В git-bash обычно в PATH, но `launch.json` для preview требует абсолютный путь.
- `psql` — не установлен локально, использовать `docker exec gmd-postgres-dev psql -U gmd -d gmd_dev -c "..."`.

**Правило:** если `which <tool>` не находит, но тул упомянут в этом CLAUDE.md или в runbook'ах — искать PowerShell'ом (`Get-ChildItem -Path C:\,D:\ -Filter '<tool>.bat' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { $_.FullName }`), не переходить в docker-workaround без проверки.

### Начальная установка

```bash
pnpm install              # JS/TS-зависимости
melos bootstrap           # Dart/Flutter-зависимости (требует flutter в PATH)
```

### Docker-стек (Postgres + PostGIS, Redis, MinIO, Adminer)

```bash
pnpm stack:up             # поднять все сервисы
pnpm stack:down           # остановить (volumes сохраняются)
pnpm stack:reset          # остановить + удалить volumes (сброс БД!)
pnpm stack:logs           # следить за логами всех сервисов
pnpm stack:ps             # статус сервисов
```

Порты по умолчанию (`infra/docker/.env.dev.example`): Postgres `5432`, Redis `6379`, MinIO API `9000` / Console `9001`, Adminer `8080`.

**Если локальный порт занят** (например, на машине разработчика уже крутится свой PostgreSQL или другой docker-стек), переопределить порты в `infra/docker/.env.dev` и согласовать с `apps/backend/.env` (`DATABASE_URL`, `REDIS_URL`). Локальная dev-машина проекта использует `POSTGRES_PORT=54320`, `REDIS_PORT=63790`, `MINIO_API_PORT=9050`, `MINIO_CONSOLE_PORT=9051`.

### Приложения

```bash
pnpm dev                  # backend (3001) + web (3000) параллельно
pnpm build                # сборка всех JS/TS workspace-пакетов
pnpm test                 # Jest по всем пакетам
pnpm lint
pnpm typecheck

# Только backend
pnpm --filter @gmd/backend dev
pnpm --filter @gmd/backend prisma migrate dev --name <name>
pnpm --filter @gmd/backend prisma studio

# Mobile
cd apps/mobile-parent && flutter run
cd apps/mobile-child && flutter run
melos run analyze
```

### Healthchecks

- Backend liveness: http://localhost:3001/healthz
- Backend readiness: http://localhost:3001/readyz (проверяет БД + Redis)
- Web: http://localhost:3000/api/healthz

## Prod-деплой

Подробности: [docs/deploy.md](docs/deploy.md), [docs/backup-restore.md](docs/backup-restore.md), [docs/server-hardening.md](docs/server-hardening.md).

```bash
# Деплой актуального кода на gmd-prod (192.168.1.23)
bash infra/deploy/deploy.sh

# Проверки
curl http://192.168.1.23/api/readyz                 # {status:ok,db:up,redis:up}
ssh gmd-prod 'docker ps --format "{{.Names}} {{.Status}}"'

# Бэкапы PG (systemd timers)
ssh gmd-prod 'systemctl list-timers | grep pg-'
ssh gmd-prod 'ls /opt/gmd/backups/postgres/'
```

Сервер доступен по `https://gmd.link28rus.ru/` (DNS A → 95.104.240.111, прямой публичный IP на интерфейсе `ens192`, без NAT-роутера). LAN-доступ — `http://192.168.1.23/`.

## Память и секреты

- Единственная система знаний — `mcp__memory-compiler__*`. Других vault'ов нет.
- `MC_ENCRYPT_KEY` — настроить, чтобы `save_secret` работал (сейчас credentials не шифруются).
- SSH/DB/API-ключи — только в `.env` и зашифрованно в memory-compiler.
- Никаких секретов в git.

## Язык

Общение на русском. Идентификаторы кода, API-названия — английский.
