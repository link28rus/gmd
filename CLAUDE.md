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
releases/rustore/       AAB-артефакты для RuStore (см. ниже)
```

Менеджер: **pnpm workspaces + Turborepo** (JS/TS), **Melos** (Flutter).

## Инфраструктура

- **Сервер (с 2026-05-15, task #67):** VPS 45.67.230.87, Ubuntu 24.04 LTS,
  4 vCPU / 8 GB RAM / 89 GB disk, единственный публичный интерфейс `ens3`
  (45.67.230.87/24, прямой IP без NAT). Loopback (127.0.0.1) и docker
  bridges (172.x) — служебное, не трогать. UFW: только 22/80/443.
- **Прежний сервер (до 2026-05-15):** dual-WAN 192.168.1.23 (ens160 LAN) +
  95.104.240.111 (ens192 WAN), потребовал asymmetric-routing fix через
  CONNMARK fwmark 0x2. Теперь работает только как 301-редирект на
  gmd-online.ru (см. memory-compiler runbook). После 90 дней — выключение.
- **Домен:** gmd-online.ru (DNS A → 45.67.230.87, TLS Caddy + Let's Encrypt
  автоматически через ACME http-01 на :80)
- **Регион данных:** РФ (152-ФЗ)
- **SSH (key-only):** алиас `gmd-online` (root + non-root sudo-user `gmd`,
  оба с ключом `id_ed25519_servers`). Password-auth отключён.
  fail2ban + UFW активны.
- **Мониторинг:** GlitchTip + Uptime Kuma (docs/monitoring.md). Доступ через
  SSH-tunnel `ssh -N gmd-online-tunnels`.

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
2. **Все нетривиальные задачи — через `gmd-taskmaster`.** Любая фича/баг/рефакторинг/деплой = задача в `.taskmaster/tasks/tasks.json`. ПЕРВЫМ действием — `mcp__gmd-taskmaster__next_task` (если работаем по плану) или `mcp__gmd-taskmaster__add_task` (если задача новая, не в плане). В процессе — `set_task_status in-progress` → логировать факты в `details` → `set_task_status done`. **Для логирования прогресса/правок details НЕ используй MCP `update_task` / `update_subtask`** — они AI-powered, спавнят внешний Claude Code CLI и регулярно падают с AbortError на больших prompt'ах (lesson #22). Вместо этого: прямой `Edit .taskmaster/tasks/tasks.json` на нужном `details` / `description` / `priority`. `set_task_status` через MCP — OK (он deterministic, без AI). **Исключения** (без задачи): однострочный typo-fix, опечатка в README, `git push` уже готовых коммитов, ответ на вопрос пользователя без правок кода. Подробности: skill `gmd-development` + `.taskmaster/CLAUDE.md`.
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
15. **memory-compiler `finish_task` агрессивно перезаписывает tracking — НЕ упоминай в `content` голые IP/URL/версии.** Экстрактор сканирует `content`/`session_summary` на IP, URL и номера версий и подставляет ПЕРВОЕ найденное значение сразу во ВСЕ поля подходящей tracking-сущности (`infrastructure`, `release`, `deployment`). Подтверждено трижды: v0.47.0 — IP adb-устройства `192.168.77.154` затёр все 9 полей `tracking/infrastructure`; 2026-06-02 (дважды) — `127.0.1.1` из текста затёр `infrastructure`, а версия Kuma `1.23.17` затёрла ВСЕ поля `tracking/release` (versionCode'ы + version) на `1.23.17`. **Mitigation (обязательно):** (а) писать `content`/`session_summary` БЕЗ литералов IP/URL/версий — описывать прозой («версия Kuma», «старый сервер», «push-токен»); конкретные значения держать в `save_lesson` (он tracking НЕ трогает) или в git-коммите; (б) если литерал всё же нужен — явно маркировать (`adb-устройство 192.168.x.x (НЕ сервер)`); (в) после КАЖДОГО `finish_task` нетривиальной задачи — `get_current entity=infrastructure` И `entity=release`, сверить, восстановить через `save_tracking` при порче.
16. **Релиз web + APK — два независимых шага.** Endpoint `/api/public/updates/<app>/latest` работает только когда сделаны ОБА: (а) `bash infra/deploy/deploy.sh` пересобрал `gmd-web` контейнер с новым route, (б) APK с правильным именем лежит в `/opt/gmd/download/`. Забыл deploy → endpoint 404 (route ещё не задеплоен). Забыл APK → endpoint 204 (нет файла под фильтр). Verify обязательно после публикации: `ssh gmd-online 'curl -sSk --resolve gmd-online.ru:443:127.0.0.1 https://gmd-online.ru/api/public/updates/mobile-{child,parent}/latest?abi=arm64-v8a'` → корректный JSON с {version, buildNumber, url}.
17. **Проверять самому, а не «закрыл, проверь сам».** Unit-тесты с моками + healthz ≠ верификация фичи. Перед `finish_task` для backend-фикса с БД-логикой или security-чувствительной правки — обязательный real-prod integration test. Паттерн для GMD: scratch-`.mjs` → `scp gmd-online:/tmp/` → `docker cp gmd-backend:/tmp/` → `docker exec gmd-backend node /tmp/script.mjs` → cleanup в try/finally. Внутри: `createRequire('/app/apps/backend/dist/main.js')` → `require('@prisma/client')` + `require('/app/apps/backend/dist/auth/...')`, sandbox-user с уникальным префиксом. Для SSR-редиректов / cookie-check — `node:http` к `web:3000` через Docker network (curl в gmd-backend нет): `http.request({host:'web', port:3000, path, headers:{Host:'gmd-online.ru', Cookie:`gmd_refresh=${token}`}})`. **Инцидент 2026-05-06 (v0.47.1):** закрыл race-condition fix только с unit-тестами + попросил пользователя проверить. Пользователь резонно указал на нарушение правила #5. Прогнал реальный test — фикс работал, но в этот же момент выяснился ВТОРОЙ баг (отсутствие SSR-редиректа), который пользователь увидел сразу — а я бы поймал самостоятельной 30-секундной проверкой через тот же scratch-pattern.
18. **Симметрия редиректов в Next.js auth — обязательная invariant.** Если есть `/cabinet → redirect('/login') if !cookie`, обязан быть и `/login → redirect('/cabinet') if cookie`. Иначе залогиненный юзер, открывая `/login` или landing с CTA «Войти» из закладки, видит форму и думает что разлогинило. Внешне это выглядит идентично «backend выкинул сессию», но первопричина и фикс — в другом слое. Чек-лист при работе над auth: для каждой страницы с server-side cookie-check спросить «есть ли обратный редирект». При диагностике user-симптома «опять просит логин» — ПЕРВЫМ делом спросить точный URL: `/cabinet` → причина в backend (race / expiry / revoke), `/`, `/login` → UX-баг в frontend (нет редиректа). **Инцидент 2026-05-06 (v0.47.2):** потратил час на race-condition fix, который был корректен, но не лечил симптом пользователя — реальная причина была в `/page.tsx`, `/login/page.tsx`, `/register/page.tsx` без SSR cookie-check.
19. **Промпт пользователя об архитектуре — гипотеза, не приказ.** Когда промпт детально описывает «как реализовать» (Drift таблица, Riverpod-репозиторий, Repository pattern и т.п.), но реальная кодовая база владеет областью по другому паттерну — следуй кодбазе, не промпту. Промпт может быть устаревшим (написан до того как часть кода ушла в native), общим (для multi-app monorepo без учёта одного app'а), или гипотезой автора без проверки кода. **Сигналы расхождения:** промпт упоминает папки/файлы которых нет (`lib/features/blocking/` при том что блокировка целиком в `android/.../BlockManager.kt`); промпт предлагает Drift-таблицу для state, который уже хранится в SharedPreferences; промпт ссылается на пакеты pubspec которых нет (`timezone` пакет не нужен при minSdk=26 — есть `java.time`). **Действие:** ПЕРВЫЕ 5-10 минут — Read/Glob ключевых файлов из промпта. Если расхождение — явно сказать пользователю «промпт ждал X, реальная архитектура Y, делаю через Y потому что …». Не молчать, не делать «как просили». **Инцидент 2026-05-06 (v0.49.0, фаза 2 расписаний):** промпт ждал Drift+Riverpod на mobile-child, но блокировка живёт в native Kotlin (BlockManager.kt + GmdAccessibilityService.kt + AppControlHttp.kt + MyFirebaseMessagingService.kt), Drift в Dart хранит только locations/audit. Реализация прошла нативно — без Drift-миграций и Dart Repository, новый `ScheduleEvaluator.kt` + расширения существующих Kotlin-файлов; Drift-путь был бы 0% useful, потому что `AccessibilityService.isBlocked()` синхронен и Drift async к нему не применим в принципе.
20. **Симметрия с существующей фичей в подсистеме — первый источник архитектуры.** Перед реализацией новой state/security-критичной фичи найти ближайшую похожую (та же подсистема, тот же триггер изменений) и скопировать её паттерн ЦЕЛИКОМ: storage layer, sync triggers (FCM message + worker fallback + startup pull), evaluator, integration с overlay/middleware. Расхождение с соседним паттерном = bug-magnet (race на обновлении state, отсутствие fallback'а, неконсистентный startup-sync). Code-review checklist для новой фичи: «**чем я отличаюсь от соседней фичи и почему?**» — каждое отличие должно иметь обоснование лучше чем «потому что Drift/Riverpod/Repository чище». Если не имеет — отличие удалить. **Введение нового паттерна** в подсистеме оправдано только если существующий имеет фундаментальный баг, не чинимый без refactor'а, ИЛИ требования новой фичи фундаментально несовместимы (sub-second latency vs SharedPreferences). В этом случае refactor затрагивает ВСЕ фичи подсистемы, не только новую. **Инцидент 2026-05-06 (v0.49.0):** schedules дублирует паттерн AppRule + BlockSession 1-в-1 — `KEY_SCHEDULES_JSON` рядом с `KEY_RULES_JSON`, FCM `SYNC_SCHEDULES` рядом с `SYNC_RULES`, `handleSyncSchedules` рядом с `handleSyncRules`, 3-й pull-блок в `BlockPollWorker`, OR-логика в `BlockManager.isBlocked`. Каждое отличие от соседней фичи документировано (combined `getCurrentBlockEndsAtMs` для overlay countdown'а — schedule имеет конец окна, не сессии; `OverlayManager.tickRunnable` не сносит активную BlockSession при schedule-only expiry — потому что окно расписания периодично).
21. **JUnit parity-тесты для Kotlin↔TS pure-функций.** Когда pure-функция реализована на двух платформах (NestJS service + Kotlin native), 28-32 spec-кейсов в JUnit, повторяющих backend spec 1-в-1, — самый дешёвый способ гарантировать parity. Стоимость ~150 строк Kotlin-теста, выгода — zero-effort regression-detection при любых будущих правках evaluator'а (DST, cross-midnight, weekday-bit). **Setup:** `testImplementation("junit:junit:4.13.2")` + `testImplementation("org.json:json:20240303")` в `android/app/build.gradle.kts`; тесты в `android/app/src/test/kotlin/<package>/<Name>Test.kt`; запуск `cd apps/mobile-child/android && ./gradlew.bat :app:testDebugUnitTest --tests '<package>.<Name>Test'`. **Helper для детерминированных моментов времени** (parity с TS `tzMoment`): `LocalDateTime.of(LocalDate.parse(date), LocalTime.parse(time)).atZone(ZoneId.of(tzId)).toInstant().toEpochMilli()`. Тесты pure-JVM (java.time не требует Robolectric), запуск ~24ms на 32 кейса. **Имена тестов = опис кейса** («cross monday 22_00 active (head today)»), не «test1». **Один тест = один edge-case** (boundary inclusive/exclusive, weekday transition, cross-midnight head/tail). **Отчёт:** `apps/mobile-child/build/app/test-results/testDebugUnitTest/TEST-<package>.<Name>Test.xml` — первая строка `<testsuite tests="N" failures="0" errors="0">` = source of truth.
22. **taskmaster `update_task` / `update_subtask` / `add_task` всегда AI-powered и часто падают на claude-code provider'е.** В `.taskmaster/config.json` все три роли (main/research/fallback) указывают `provider: claude-code` — это означает, что MCP-сервер taskmaster при каждом write-вызове **спавнит внешний Claude Code CLI как subprocess** и ждёт от него JSON-ответ. Внутри текущей сессии это reentrant call (Claude Code → MCP → Claude Code), который на больших prompt'ах (>2KB) регулярно падает с `MCP error -32001: AbortError: The operation was aborted` через ~30 секунд. **Подтверждено кодом:** `update_task` с флагом `append: true` — НЕ просто конкатенация, а отдельный AI-prompt «append additional information…» (см. `node_modules/task-master-ai/dist/dependency-manager-*.js:678`, ветка `appendMode === true`). **Симптом:** запись в `tasks.json` обычно успевает пройти ДО abort'а (виден блок `<info added on …>`), но MCP-вызов возвращает ошибку — ловушка для агента, который начинает retry'ить и дублирует данные. **Фикс навсегда: используй прямой Edit `.taskmaster/tasks/tasks.json` для всех модификаций**, кроме AI-генерации с нуля (`add_task` без готового текста, `expand_task`, `parse_prd`). Алгоритм: (а) `Grep -n '"id": <N>' .taskmaster/tasks/tasks.json` → найти диапазон; (б) `Read` диапазон ±2 строки; (в) `Edit` строку `details` / `status` / `priority` напрямую; (г) для статуса — НЕ через Edit, а через `mcp__gmd-taskmaster__set_task_status` (он deterministic, без AI). **Дополнение 2026-05-13 (попытки уйти с claude-code provider, задача #62):** обе провалились — (а) `provider: anthropic` + ключ через User env / .env / .mcp.json env — `.mcp.json` кешируется host-Claude Code при старте и не перечитывается; MCP-режим task-master-ai НЕ загружает `.env` через dotenv. (б) `provider: mcp` / `modelId: mcp-sampling` — Claude Code как MCP-host НЕ поддерживает sampling protocol (upstream issue #18 open). Финальный путь когда захочется вернуться (задача #62 = deferred): закрыть все claude.exe из внешней консоли → `setx ANTHROPIC_API_KEY` → `claude mcp add gmd-taskmaster --scope user --env ANTHROPIC_API_KEY=...` → config.json all-anthropic. Реестр task-master-ai 0.43.1: есть `claude-opus-4-5`/`claude-sonnet-4-5`/`claude-haiku-4-5`; anthropic-роль `research` НЕ поддерживается, для research нужен perplexity / openai-search / mcp-sampling / bedrock.

23. **Generic-промпт ≠ план. Большая инфра-задача требует audit + AskUserQuestion ДО первого Edit.** Когда промпт описывает «полный перенос/миграцию» в обобщённых терминах (типовые чеклисты с Telegram/WebSocket/«удалить все локальные IP»), это шаблон, а не план для конкретного проекта. Real GMD не имеет Telegram-интеграций; «локальные IP» включают необходимые docker bridges 172.x; «WebSocket» — только audio relay в одной точке. Если следовать промпту буквально — наделаешь лишнего и пропустишь критическое. **Алгоритм:** (а) ОСТАНОВИТЬСЯ ДО кода; (б) полный grep по hardcoded references (домены/IP/алиасы) с группировкой по слоям; (в) memory-compiler search про похожие миграции, текущую инфру, опубликованные mobile-версии в RuStore; (г) `AskUserQuestion` с 2-4 критическими развилками (что делать с уже опубликованными mobile-app'ами, нужна ли миграция данных, держать ли legacy-домен переходным мостом, что с незакоммиченной работой); (д) только потом — план миграции и первый Edit. **Инцидент 2026-05-15 (task #67):** избежал три потенциально катастрофических действия — (1) бросился бы в массовый replace_all без знания что mobile-child v0.50.7 уже в RuStore с hardcoded URL; (2) попробовал бы удалить все 192.168.x как «локальные» (поломав docker-bridges); (3) не заметил бы что 60+ uncommitted RuStore-Push файлов нельзя смешивать с миграцией доменов. Все три предотвратились через 4-question AskUserQuestion блок.

24. **WIP-ветка для незакоммиченной работы при пересечении с большой ортогональной задачей.** Когда working tree содержит большую завершённую логическую единицу (60+ файлов, новая фича) И прилетает второй большой ортогональный change (миграция инфры) — нельзя смешивать в один коммит и нельзя оставлять untracked во время второй задачи (lesson #36 split-deploy через stash работает только для маленьких WIP-нагрузок, для больших stash рискован). **Правильный flow:** (а) `git checkout -b feat/<wip-name>`; (б) `git add -A && commit` — закоммитить целиком как WIP с описанием что внутри; (в) добавить в `.gitignore` каталоги untracked-артефактов которые не должны светиться в main (`releases/`, `__pycache__/`, etc), чтобы после `checkout main` они оставались физически на диске но не светились в `git status`; (г) `git checkout main` — чистое состояние, можно делать вторую задачу; (д) после стабилизации main — merge feature-ветки, готовиться к конфликтам в pubspec.yaml/env.dart/CLAUDE.md/CHANGELOG.md/package.json (резолвить в пользу main для версии и URL'ов, в пользу feature для функционального кода). **Инцидент 2026-05-15 (task #67):** WIP RuStore Push (1116+/2414- строк) унесён в `chore/rustore-push-wip` (commit 6c6effb), main HEAD остался на `7cff44b`, миграция доменов прошла отдельным коммитом `b3d5d63` (42 файла), pubspec bump — третьим `316e5b4`. История читаемая, откатить можно любой шаг отдельно.

25. **pg_restore с PostGIS — drop+recreate db ОБЯЗАТЕЛЕН.** При первом старте контейнера `gmd-postgres:16-postgis-pgcron` postgres-init-скрипт автоматически создаёт схемы PostGIS (public/postgis/tiger/topology). Дамп со старого прода тоже содержит `CREATE SCHEMA tiger`, что вызывает конфликт. Варианты: **(а) `--single-transaction`** падает на первом конфликте, ВСЁ откатывается → данных в БД нет. **(б) Без `--single-transaction`** — restore идёт дальше с warnings, но оставляет orphaned objects (плохо). **(в) Правильно:** `DROP DATABASE gmd; CREATE DATABASE gmd OWNER gmd;` → `pg_restore -d gmd --no-owner --no-acl`. Перед DROP — `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='gmd' AND pid <> pg_backend_pid();` (pg_cron worker и connection pool держат коннекты, иначе DROP падает с `database is being accessed by other users`). После restore — verify count: `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM invites) AS invites, ...` за один запрос. **Инцидент 2026-05-15:** pg_restore с `--single-transaction` упал на CREATE SCHEMA tiger → откат всего. Drop+create+restore без single-transaction → 203 warnings про existing objects, ignored, данные на месте (7 users / 58 invites / 22 children / 8 families / 8 zones / 45728 locations).

26. **Cross-branch Prisma migrations conflict при restore + WIP-ветке.** Если на проде применены миграции, которых ещё нет в main коде (потому что они в feature-ветке) — после restore `_prisma_migrations` содержит «лишние» записи. Backend на main: (а) если миграции в `_prisma_migrations` НО код их не ожидает в `prisma/migrations/` папке → `prisma migrate deploy` упадёт с error «database has applied migrations not present in your migrations directory»; (б) если колонки в БД НО backend не ссылается на них в Prisma-запросах → работает (no-op). **Решение:** `DELETE FROM _prisma_migrations WHERE migration_name IN ('<wip-mig-1>', '<wip-mig-2>')` → удалить записи «из будущего», оставить колонки в таблицах. `prisma migrate deploy` после этого скажет «No pending migrations to apply». **При будущем merge feature-ветки в main:** `prisma migrate deploy` снова упадёт — теперь жалуясь что миграции есть в коде НО колонки уже существуют в БД. Mitigation: `prisma migrate resolve --applied <migration-name>` для каждой такой → пометит как успешно применённую без попытки повторного выполнения SQL. **Инцидент 2026-05-15:** dump со старого прода имел в `_prisma_migrations` записи `20260512120000_add_rustore_push_token` + `20260514170000_add_multi_use_invites` (применены руками в task #65), которых нет в main. Удалил записи → backend на main работает с лишними колонками `invites.maxUses/usesCount` + `parent_devices.rustorePushToken`, не трогая их. Модераторский invite AJGD3K2D с maxUses=100 сохранён.

27. **Caddy storage path при переиспользовании cert от прежней инстанции — двойной `/data/caddy/`.** При запуске нового Caddy с старым storage volume надо понимать как был смонтирован прежний. Если предыдущий Caddy запускался с `-v /opt/gmd/data:/data` — он сохранял cert в хост-путь `/opt/gmd/data/caddy/certificates/...` (внутри контейнера `/data/caddy/`). Если перемонтировать новым Caddy как `-v /opt/gmd/data/caddy:/data` — Caddy ищет cert в `/data/caddy/...` = хост-путь `/opt/gmd/data/caddy/caddy/certificates/`, которого НЕТ → попытается выписать новый ACME cert. На staging-CA challenge может падать («connection refused» если старый сервер за asymmetric routing) → cert не выписан → HTTPS error. **Чек перед mount:** `find /opt/gmd/data -name "*.crt" -path "*/certificates/*"` найдёт реальный путь существующих cert'ов; правильный mount = subdir такой что внутри контейнера cert окажется в `/data/caddy/certificates/<ca>/<domain>/`. **Инцидент 2026-05-15:** прежний gmd-caddy сохранял в `/opt/gmd/data/caddy/data/caddy/certificates/...` (двойной `data/caddy/`). Mount `/opt/gmd/data/caddy:/data` не нашёл cert → ACME → connection refused → HTTPS down. Fix: `-v /opt/gmd/data/caddy/data/caddy:/data/caddy` → Caddy сразу нашёл cert и не пытался выписать новый. HTTPS заработал из коробки на старом домене (для 301-редиректа).

28. **Android install paths не равноценны для permission-сохранения на MIUI/HyperOS.** Эмпирически подтверждено в задаче #61 (POCO X7 Pro / HyperOS, arm64) при тесте 2026-05-07: один и тот же APK с одним keystore по-разному triggerит OS-policy в зависимости от **транспорта установки**. **(а) `Intent(ACTION_VIEW)` + FileProvider URI + системный installer** (старый `installer_channel.dart`) → MIUI Restricted Settings treat'ит как «sideload-source» → деактивирует `AccessibilityService` (часто и Device Admin) при upgrade'е. **(б) `adb install -r` через ADB transport** → MIUI **НЕ деактивирует** ничего (a11y, Device Admin, SAW, runtime perms — все сохраняются). **(в) Trusted store update** (Play Store / Mi App Store / RuStore) → не деактивирует. **(г) `adb install` без отключения verifier'а** падает с `INSTALL_FAILED_VERIFICATION_FAILURE` — фикс через `adb shell settings put global verifier_verify_adb_installs 0` ДО install + восстановление в 1 ПОСЛЕ (security-policy не должен оставаться weakened). **Архитектурное следствие:** наш sideload auto-update через ACTION_VIEW был наименее благоприятным путём по сохранению permissions; в v0.50.4 удалён, переход на RuStore In-App Updates (lesson #29).

29. **Distribution Android-приложения с stalkerware-like permission set требует размещения в trusted store, иначе постоянная битва с OS-policies.** Permission-набор GMD child (`BIND_ACCESSIBILITY_SERVICE` + `SYSTEM_ALERT_WINDOW` + `RECORD_AUDIO` + `ACCESS_BACKGROUND_LOCATION` + `PACKAGE_USAGE_STATS` + Device Admin) эвристически = классический stalkerware-профиль. Это влечёт три **независимых** проблемы distribution через self-hosted endpoint: **(а) Google Play Protect** на чистых Android (Pixel/AOSP/большинство OEM с GMS) детектит наш sideload-APK как «Вредоносное приложение — это приложение подделка», блокирует install (default Flutter `ic_launcher.png` 442–1443 байта = дополнительный сигнал «нет собственной иконки → fake»). **(б) MIUI/HyperOS Restricted Settings** деактивирует AccessibilityService при любом sideload-обновлении (lesson #28). **(в) Auto-update через ACTION_VIEW** триггерит OS-policy сильнее чем ADB или trusted store. Решается **только** размещением в trusted store: для РФ-рынка — RuStore (зарегистрирован в Android 12+ как trusted installer, GPP не сканирует apps оттуда, MIUI не сбрасывает permissions через RuStore push API). Google Play **не подойдёт** для текущей архитектуры — Family/Parental Controls policy запрещает наш use-case AccessibilityService-blocking без Device Owner; зафиксировано в `docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md` как «AccessibilityService для блокировки apps = высокий риск ремува из Play Store. Основной канал распространения — RuStore». Эвристические workaround'ы (custom branded иконка, Play Console registration с internal track) снижают вероятность detection, но не устраняют все три проблемы — закрывает только trusted store. **Custom иконка** при этом — обязательный baseline (default Flutter robot 442–1443 байт = self-inflicted сигнал malware).

30. **Wireless ADB на Android 11+ — двухступенчатый flow с двумя разными портами.** Pair-port (показывается на экране «Подключение устройства с помощью кода связи», случайный 30000+) — **одноразовый** для trust establishment с PIN: `adb pair <ip>:<pair_port> <PIN>`. Main adb-port (показывается на основном экране «Беспроводная отладка», тоже случайный, **не равен pair-port**) — для постоянной работы: `adb connect <ip>:<adb_port>`. Если первый `connect` к pair-port'у возвращает `cannot connect ... отверг запрос на подключение` после успешного pair — это **нормально**, нужен другой port (тот что отображается на основном экране). После сессии — обязательный cleanup: `adb disconnect <ip>:<port>` + если включали verifier-bypass на MIUI — `settings put global verifier_verify_adb_installs 1` восстановить (security-policy не оставлять weakened). **Безопасный install flow на чужом устройстве** (lesson #12 + 2026-05-07): (1) `adb -s <serial> shell dumpsys package <pkg> | grep -E "versionName|versionCode|signatures="` — текущая версия и signature digest; (2) сверить с `apksigner verify --print-certs <new.apk>` — SHA-1 должен совпадать; (3) **только** `adb install -r` (без `flutter install`, без `-d`!) — на mismatch подписей adb откажет error'ом без uninstall и data loss; (4) verify через повторный `dumpsys` что versionCode обновился; (5) `adb -s <serial> exec-out screencap -p > screen.png` для визуальной проверки UI (не полагаться только на dumpsys, lesson #5); (6) удалить временные файлы (.tmp_screen.png и т.п.) из working tree до коммита.

31. **RuStore Console wizard для upload версии — quirks которые нужно знать заранее.** Подтверждено при первой подаче parent+child apps GMD в задаче #64 (2026-05-12). **(а) «Страница приложения» появляется только ПОСЛЕ upload первой версии** — кнопки «Заполнить страницу» нет; все текстовые поля (name/short/long, категория, возраст, контакты) заполняются внутри 5-шагового wizard'а «Загрузить версию» (шаг «Информация»). Альтернативный путь — «Создать предзаказ» (но он показывает в RuStore «Скоро» вместо «Установить»). **(б) «Сохранить как черновик» теряет non-validated поля** при выходе и возврате — длинное описание, обоснование sensitive permissions, комментарий модератору регулярно стираются. Mitigation: либо проходить wizard до конца за один заход, либо хранить тексты в `docs/rustore-store-listing.md` и копировать при каждом редактировании черновика. **(в) Жёсткие лимиты полей** (не документированы в help'е, обнаруживаются по counter'у): комментарий модератору на шаге «Файлы» — **180 символов**; обоснование permissions на шаге «Безопасность» — **1500 символов**; длинное описание — 4000; краткое — 80; название — 50. **(г) Featured graphic 1024×500 — отдельного поля в wizard'е нет**; есть только «Иконка приложения 512×512», «Скриншоты телефонов 1920×1080 16:9», «VK Видео» и «Фоновое видео». Featured-баннер скорее всего настраивается через отдельный раздел «Страница приложения» уже после publication. **(д) RuStore сам парсит sensitive permissions из AndroidManifest** и показывает их в шаге «Безопасность» — вручную выбирать ничего не нужно, только заполнить общий textarea обоснования. **(е) Программный multi-select** (MUI combobox с checkboxes для «Запрашиваемые данные» 0/38) требует `await sleep(120-150ms)` между `cb.click()` иначе React теряет state — последовательность click'ов в одной микротаске сохраняет только последний. Re-query DOM перед каждым click, потому что uid'ы инвалидируются при re-render. **(ё) Один keystore = первая подпись = навсегда.** При создании Application Record загружается public certificate; все последующие версии должны быть подписаны тем же ключом. Менять keystore нельзя без support-тикета.

32. **Promo-карточки как baseline скриншотов 1920×1080 — приемлемый workflow когда устройства/тестовой семьи под рукой нет.** В задаче #64 модераторская модерация требует мин. 1 скриншот 16:9 для submit, реальные UI-скрины невозможны без реального устройства + наполненных тестовых данных. Решение: `tools/icons/generate_app_icons.py render_promo_screenshot(accent, title_lines, subtitle, pin_letter)` — radial-фон в фирменной палитре + крупный pin-bubble слева с акронимом (G, QR, SOS, LOCK, ZON, 24/7) + многострочный title и subtitle справа. Это маркетинговые карточки, не настоящие UI. **Trade-off:** parent app с минимальным permission-набором модератор скорее всего пропустит promo; child app со stalkerware-like permission set модератор скорее всего вернёт с «дайте реальные скриншоты UI». Promo-карточки = быстрый старт модерации (1-3 дня) пока готовим реальные скрины параллельно. Реальные скрины делать на эмуляторе/устройстве через `adb shell screencap -p > shot.png` (1080×1920 portrait — RuStore примет и обрежет до 16:9). **Эмодзи в шрифте Segoe UI Bold не рендерятся** — заменять символами/акронимами. Subtitle прижать к нижней зоне `H - sub_h - 13%` иначе наезжает на хвост pin'а у 2-строчных title.

33. **Next.js 15 App Router metadata-file convention — самый дешёвый путь для favicon/icon.** Файлы `favicon.ico` / `icon.{png,svg}` / `apple-icon.png` КЛАДУТСЯ В `apps/web/app/` (рядом с `layout.tsx`), **НЕ в `apps/web/public/`**. Next.js сам инжектит `<link rel="icon">` и `<link rel="apple-touch-icon">` в `<head>` без правки `metadata.icons` в `layout.tsx`. Подтверждено в задаче #65: положил 4 файла → dev-сервер сразу показал 3 link-тега в head (favicon.ico 16×16 + icon.png 512×512 + apple-icon.png 180×180). **Gotcha:** `icon.svg` рядом с `icon.png` доступен через endpoint (`GET /icon.svg` → 200), но Next в head его НЕ инжектит автоматически — берёт первый по приоритету (png). Если нужен SVG-link — прописать руками через `export const metadata = { icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, ...] } }`. **Cache-busting** Next делает через query-параметр (`/icon.png?59e2605b45240eb6`) — это норма, не баг. **Размеры:** ICO multi-res через Pillow `img.save(path, format='ICO', sizes=[(16,16),(32,32),(48,48)])`; apple-icon **обязательно** с padding'ом 10-12% — iOS добавляет rounded-mask и без padding'а контент клипнется. Док: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons. Web-контейнер пересобирается через `bash infra/deploy/deploy.sh` — hot-mount/HMR на prod не работает, новые статические файлы из `app/` попадают в `.next/static/...` только через build.

34. **Pre-commit hook'и в репо: lint-staged + commitlint footer-max-line-length=100, husky pre-commit + commit-msg.** При коммите husky запускает: (а) lint-staged (`prettier --write` на _.{json,md,yaml,yml}, `eslint --fix` на _.{ts,tsx,js,jsx}) — это автоформатирует staged-файлы; (б) `pnpm version:check` — падает при рассинхроне версий в монорепо; (в) commitlint — Conventional Commits + строгий лимит на длину строк, **100 символов на каждую строку body+footer (`footer-max-line-length=100`, `body-max-line-length` тоже)**. Один длинный абзац без переносов → reject `husky - commit-msg script failed (code 1)`. **Mitigation:** в `git commit -m "$(cat <<'EOF' ... EOF)"` оборачивать строки до ~80 символов (не до 100 — Co-Authored-By footer тоже считается). Не использовать `--no-verify` (CLAUDE.md «никогда без явной просьбы»). **Подтверждено 2026-05-12 task #65:** первый commit упал на длинной строке `Next.js 15 App Router convention-based metadata: apps/web/app/{favicon.ico, icon.png, apple-icon.png, icon.svg} — Next сам инжектит ...` (>100 chars). После wrap → прошёл с первой попытки.

35. **Split-deploy через git stash проверен на production второй раз — паттерн стабилен.** `infra/deploy/deploy.sh` tar-pipe'ит **текущее состояние диска** (modified + untracked), НЕ HEAD. Когда working tree содержит несколько НЕзакоммиченных фич — нужно отделять. Алгоритм: (а) `git add` файлов целевой фичи → `git commit` (husky пройдёт чисто, остальные файлы он не трогает); (б) `git stash push --include-untracked -m "<wip-tag>"` — working tree становится чистым (= HEAD = только closed-фича); (в) `bash infra/deploy/deploy.sh` — едет HEAD; (г) `git stash pop` — wip-фичи возвращаются без конфликтов. **Подтверждено task #65 2026-05-12:** working tree содержал #64 RuStore-changeset (47 файлов) + #65 favicon (4 файла) → split-commit favicon → stash RuStore → deploy → pop. RuStore-changeset restored 1-в-1, ноль конфликтов. **Сигнал к split-deploy:** `git status --short | wc -l` > 10 файлов из разных областей (backend + mobile + web одновременно) И пользователь просит выкатить только одну подобласть.

36. **RuStore-модерация: forbidden permissions полный список (по состоянию на 2026-05).** Перед каждой подачей AAB обязательно `aapt2 dump permissions <aab>` (путь на Windows: `C:/Users/link2/AppData/Local/Android/Sdk/build-tools/35.0.0/aapt2.exe`) — проверить отсутствие: (а) `REQUEST_INSTALL_PACKAGES` (lesson v0.50.4: «все обновления должны происходить централизовано через RuStore», убираем permission + auto-update через `flutter_rustore_update.RuStoreUpdates.tryImmediate()`); (б) `QUERY_ALL_PACKAGES` (lesson v0.50.5: «не соответствует нормам информационной безопасности», заменяем на `<queries><intent><action MAIN/><category LAUNCHER/></intent></queries>` + `pm.queryIntentActivities(Intent(ACTION_MAIN).addCategory(CATEGORY_LAUNCHER))` в Kotlin). Остальные sensitive permissions (BIND*ACCESSIBILITY_SERVICE, BIND_DEVICE_ADMIN, SYSTEM_ALERT_WINDOW, PACKAGE_USAGE_STATS, ACCESS_BACKGROUND_LOCATION, RECORD_AUDIO+FOREGROUND_SERVICE_MICROPHONE) проходят, **но обязательно** требуют обоснования в шаге «Безопасность» wizard'а (1500 char textarea) — без него модерация шаблонно отклоняет. Шаблон обоснования для parental-control приложения — см. `releases/rustore/child/PUBLISH_v0.50.7.md`. Также не нашёл reason для отказа: `MODIFY_AUDIO_SETTINGS`, `VIBRATE`, `ACTIVITY_RECOGNITION`, `USE_EXACT_ALARM`, `FOREGROUND_SERVICE*\*`, `NEARBY_WIFI_DEVICES`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — проходят молча.

37. **Multi-use invite для тест-аккаунта модератора — обязателен для stalkerware-like apps в RuStore.** Lesson v0.50.6: модель `Invite` была single-use (`consumedAt=NOW()` после первого claim), модератор N+1 итерации получал `invite_invalid` → отказ «вход не осуществляется». Фикс: в `Invite` добавлены `maxUses Int @default(1)` + `usesCount Int @default(0)`. При `maxUses > 1` `ChildDeviceService.claim` авто-revoke'ает existing `activeDevice` (каждый новый модератор начинает «с чистого»), `consumedAt` ставится только когда `usesCount >= maxUses`. Создание moderator invite: на проде через `docker exec gmd-postgres psql -U gmd -d gmd -c "UPDATE invites SET \"maxUses\"=100, \"usesCount\"=0, \"consumedAt\"=NULL, \"expiresAt\"=NOW()+INTERVAL '365 days' WHERE code='AJGD3K2D';"`. **В комментарии модератору обязательно явно указать «многоразовый, работает повторно»** — иначе модератор может попытаться и при первом fail (если invite случайно consumed/expired) отклонит без повтора. Шаблон комментария 158/180 chars: `«Логин: <email>, пароль: <pwd> (<host>/login, «По паролю»). Код <CODE> — многоразовый, работает повторно.»`.

38. **RuStore Console wizard: skip-on-resubmit паттерн.** На свежем submission (`/versions/add`) часть полей **сохранена с уровня Application Record** (название, основное описание, category, иконка), но **textbox с шага Безопасность («Запрашиваемые данные» multi-select 0/38, «Обоснование разрешений» 1500 char) + комментарий модератору + «Что нового» + media files** теряются при каждом новом visit'е. **Правило прохождения:** (а) не выходить из wizard'а между шагами; (б) если submit вернул на «Информация» с warning triangle — пройти JS-сниппет на красные сообщения (`/rgb\(255,\s*51,\s*71\)/`), заполнить ВСЕ найденные поля, **перезалить иконку + screen** на шаге Медиа (они тоже сбрасываются), и **только потом** retry submit; (в) react-select dropdowns в Console **НЕ открываются** обычным `element.click()` — нужен `ctrl.dispatchEvent(new MouseEvent('mousedown'/'mouseup'))`; (г) multi-select клики 9 опций — `await sleep(200ms)` между `option.click()` (React теряет state без паузы). Полные wizard-шаблоны для GMD-child — `releases/rustore/child/PUBLISH_v0.50.7.md`.

39. **Скриншот для RuStore «Скриншоты для телефонов»: real-device чистый UI без модалов.** Lesson v0.50.4 (моя ошибка): первый скрин `child-01-permissions-guard.png` показывал post-update modal поверх UI — модератор посчитал «приложение не запускается». Правило: перед `adb exec-out screencap -p` (а) закрыть все модалы / consent banners / post-update guards (нажать «Позже» / «Понятно»); (б) свайпнуть notification shade если есть нотификации; (в) дождаться чистого main screen (для child — главный SOS экран); (г) сразу после screencap'а — **visual review** через `Read` файла в Claude перед commit'ом. Обработка: `python tools/rustore/process_screenshots.py <input.png> releases/rustore/<app>/screenshots/<app>-01-main.png` (top-bias crop 9:20 → 9:16 1080×1920). Имя файла: `<app>-<NN>-<descriptor>.png` — NN определяет порядок в каталоге (первая = preview, должна быть «продающей»).

40. **Прочитать existing code в области ДО планирования task'и с многими файлами.** Изначальный план task #69 (auto-cleanup ghost audio-сессий) предполагал: новый `AudioCleanupService`, `@nestjs/schedule @Cron`, отдельный relay HTTP endpoint `/internal/sessions/active` с shared-token auth, Prisma migration для новых `AudioFailureReason`, Prometheus метрики — оценка ~5-8 файлов изменений + новый внутренний API. После 5-минутного чтения `audio.gateway.ts` + `audio.relay.ts` + `audio.service.ts` + prisma schema выяснилось: (а) relay живёт ВНУТРИ backend, cross-service endpoint не нужен; (б) watchdog с setInterval + `relay.findIdleSessions` УЖЕ работает раз в 60с; (в) `expireOrFail` УЖЕ шлёт STOP_AUDIO push через `sendHybridDataMessage`; (г) `RelayCallbacks.onIdleExpire` callback УЖЕ был зарезервирован архитектурой; (д) все нужные `AudioFailureReason` enum'ы (`CHILD_OFFLINE`, `NETWORK_ERROR`, `PARENT_TIMEOUT`) УЖЕ были. Реальный gap — ~150 строк: `AudioRelay.activeSessionIds()`, `AudioService.cleanupOrphans()`, второй шаг в существующем watchdog'е, расширение типа `expireOrFail`. **Правило:** перед `add_task` для тех. задачи с заявленными >2 файлов изменений — обязательное чтение ключевых файлов в области (Read 3-5 файлов, ~30 сек) → реальная оценка gap → правильный scope. Симптомы overscoping: «новый сервис для X» когда X уже есть в существующем сервисе; «новый endpoint» когда нужный callback уже определён в типах; «migration enum» когда enum уже расширен. Дешевле скорректировать scope в `details` до коммита, чем удалять ненужный код позже.

41. **Релизный workflow трёхэтапный: AVD → реальное устройство по Wi-Fi → RuStore. Каждый этап БЛОКИРУЮЩИЙ.** Изменения в mobile-_ (особенно child app со stalkerware-like permission set) не публикуются в RuStore Console до прохождения обоих preceding этапов. **(Этап 1) AVD smoke:** `flutter build apk --release --target-platform=android-x64 --build-name=<X.Y.Z> --build-number=<N>` → `adb -s emulator-_ install -r <apk>`→ golden path (для child — claim invite + permissions + main SOS экран; для parent — login + список детей + карта). AVD ловит regression'ы из non-GMS окружения (модератор RuStore тестирует именно так, lesson v0.51.1 reject). **(Этап 2) Реальное устройство по Wi-Fi:** ловит OEM-specific bugs (MIUI/HyperOS restricted settings, Device Admin policy, real FCM token rotation, real GPS точность). Подключение по ADB-over-WiFi: запросить у пользователя`<ip>:<port>`из «Беспроводная отладка» (Android 11+ двух-этапный pair+connect, lesson #30),`adb connect`, `apksigner verify --print-certs <new.apk>`+`adb shell dumpsys package <pkg> | grep signatures`сверить SHA-1, **только**`adb install -r`(не`flutter install`, lesson #12). **Если устройство не подключено** — НЕ переходить к этапу 3, СНАЧАЛА запросить у пользователя «подключи телефон ребёнка или свой по Wi-Fi отладке, дай мне `<ip>:<port>`». **(Этап 3) RuStore:** `flutter build appbundle --release`→`releases/rustore/<app>/gmd-<app>-X.Y.Z+N.aab` → Playwright submit. **Симптомы пропуска этапов:** «AAB пересобран — отправляю в Console» без emulator/device тестов = ~80% шанс reject от модератора (lesson v0.51.1 «аварийно закрывается после авторизации» — был бы пойман на любом AVD за 2 минуты). **Исключения** (этап 2 можно пропустить, если этап 1 пройден): чисто-doc или web-only коммиты, где mobile AAB просто rebuild без логических изменений и предыдущая версия с тем же кодом уже отработала на реальном устройстве — но это редкий edge case, по умолчанию проходим оба.

42. **Пользовательский PNG для UI-asset проверить на тип ДО Image.asset — mockup-всего-экрана или чистая иллюстрация.** Когда пользователь присылает картинку для onboarding/hero, она часто содержит mockup ВСЕГО экрана (с текстом «Привет!», подзаголовком, кнопкой) — это reference для дизайна, не asset для `Image.asset`. Если положить как есть, на устройстве будет дубль: PNG-текст «Привет! Это X» виден в иллюстрации + настоящий `Text widget` ниже. **Правило:** перед интеграцией (а) открыть PNG через `Read` (доступен через мультимодальный input), (б) визуально определить: чистая иллюстрация (можно `Image.asset` напрямую) или mockup (нужен crop). Для crop'а — `python -c "from PIL import Image; src=Image.open('...'); src.crop((x0,y0,x1,y1)).save(...)"` за ~5 секунд, координаты эмпирически по превью. Альтернатива: спросить пользователя «прислал mockup всего экрана или только иллюстрацию?» — 10 сек vs итерация build/install/screencap (~3-5 минут). **Инцидент 2026-05-17 (rebrand «Перископ»):** пользователь прислал AI-generated 1030×1527 mockup всего onboarding-экрана. Я положил как `onboarding_hero.png`, build+install на AVD → видны два «Привет! Это Перископ» (один в PNG, второй настоящим Text). Пришлось crop'ить до (230,130,800,780) — щит-иллюстрация без текста и кнопки → повторный build+install. Цена ошибки ~2 минуты Gradle build; visual review через Read до install сэкономил бы их.

43. **При cross-stack фиче (backend + mobile вместе) backend deploy ДОЛЖЕН быть ДО AVD-теста, не после.** Если backend меняется (новое поле в API ответе) синхронно с client'ом который его читает — AVD-test после backend deploy = валидный (читает новое поле). AVD-test до backend deploy = полу-валидный, видит только client-side изменения, новое поле приходит `undefined`. **Правило:** при changes spanning backend + mobile-child/parent, последовательность: (а) write backend code + tests; (б) write mobile code (consume new field); (в) `bash infra/deploy/deploy.sh` → verify `curl /api/readyz`; (г) **только теперь** AVD-test по lesson #41 этап 1; (д) реальное устройство этап 2; (е) AAB submit этап 3. Если deploy пропустить и положиться на «AVD читает старый backend, на проде потом заработает» — миссируешь race condition: mobile-build уже несёт fetchMe-код ожидающий новое поле, при `fallback null` UI деградирует тихо. **Инцидент 2026-05-17 (family.name):** добавил поле `family: {id, name}` в `/child/me`, mobile-client `ChildMeResult{familyName}`. Сделал AVD test ДО deploy → home показал старый текст «Ты подключён к семье» без имени, потому что backend ещё отвечал старым форматом. После `deploy.sh` + reinstall на AVD → имя появилось. Если бы не заметил — отправил бы в RuStore полу-сломанную фичу.

44. **PIN устройства для тестов — сразу в auto-memory как reference, не запрашивать каждую сессию.** Для real-device тестирования по lesson #41 этап 2 на HyperOS/MIUI экран часто гасится между adb-командами (короткий screen*off_timeout), screencap возвращает 8KB чёрного PNG пока `mDreamingLockscreen=true`. `settings put global stay_on_while_plugged_in 7` помогает не всегда (зависит от charging state, OEM-overrides). `adb input keyevent KEYCODE_WAKEUP + swipe + input text <PIN>` — детерминированный unlock. **Правило:** при первом подключении к чужому устройству в сессии спросить PIN, сохранить в `~/.claude/projects/<proj>/memory/reference_device_pin*<name>.md`(auto-memory, вне git, персистит между сессиями). Добавить туда же`<ip>:<port>` (даже зная что port случайный — для контекста) и точную unlock-последовательность. В будущих сессиях не дёргать пользователя «разблокируй». **Что в файле должно быть:** PIN, model (для context который keyevent codes применять), команда-шаблон unlock'а. **Что НЕ должно:** реальный личный PIN человека без явного разрешения сохранить (спросить «можно я запомню PIN?» — пользователь решает). **Инцидент 2026-05-17:** при тесте на Тимохе ~8 раз вернулся к lockscreen из-за HyperOS aggressive sleep, упорно пытался unlock через swipe (попадал в NotificationShade), запрашивал пользователя 2 раза. После того как пользователь дал PIN 6555 — unlock детерминирован, оставшийся тест прошёл за 30 секунд.

45. **RuStore Console «Возрастное ограничение» и «Поисковые теги» сбрасываются на default при каждом wizard'е и НЕ редактируются self-service после approve.** В шаге «Информация» Console wizard'а (`/apps/<id>/versions/add`) есть два поля, которые без явного действия попадают в Page Record (read-only public catalog state) пустыми/неверными: (а) «Возрастное ограничение» — default `0+` даже если предыдущая published version была 6+, контрол это react-select (см. lesson #38 dispatch mousedown/mouseup); (б) «Поисковые теги (0/5)» — default пустые, max 5 keywords. **После publication** эти поля видно на `https://console.rustore.ru/apps/<id>` в блоке «Категории → Возрастная / Поисковые теги», но **отдельно редактировать их нельзя** — никаких кнопок «Изменить», вся Page Record синхронизируется только с последней approved submit'ой. Это означает: если в submit'е забыл выставить age и заполнить tags, исправить можно только новой submit'ой → bump pubspec build, rebuild AAB, новый wizard, ждать модерацию. **Правило:** в каждой `releases/rustore/<app>/PUBLISH_*.md` явно прописывать «6+» для age и список 5 тегов (для child — `перископ`, `родительский контроль`, `геолокация ребёнка`, `gmd`, `sos`; для parent — `gmd`, `родительский контроль`, `геолокация ребёнка`, `геозоны`, `sos`). Тег `gmd` обязателен **даже после rebrand'а** потому что legacy-пользователи продолжают искать по старому имени (search-index сохраняется надолго). Тег `перископ` обязателен потому что search-index по display name не обновляется мгновенно после rebrand'а. **Post-submit verify:** после approve открыть Page Record и проверить блок «Категории» — если возрастная default 0+ или теги пустые, делать resubmit. **Инцидент 2026-05-17 (v0.51.2 rebrand):** в wizard'е выставил 6+, в Page Record после approve осталось 0+; теги не заполнил вообще; поиск «перископ» в RuStore возвращал ноль карточек, поиск «gmd» возвращал нашу карточку с display name «Перископ Ребёнка» через legacy search-index. Self-service edit недоступен → правильный fix только bump 0.51.3+6091 со ВСЕМИ полями. На момент инцидента решили не resubmit'ить, а зафиксировать reminder в шаблонах для следующего submit'а по другому поводу.

46. **Мониторинг и бэкапы — часть инфраструктуры: при миграции переноси операционный слой и verify что он РАБОТАЕТ, а не «существует».** Инцидент 2026-05-30/06-01: прод-аутаж Redis висел ~10ч незамеченным, потому что миграция сервера (#67) перенесла app-контейнеры, но НЕ операционку. Три независимых грабли, все transferable. **(а) Сломанный/вечно-DOWN монитор маскирует реальный сбой.** HTTP-мониторы Uptime Kuma остались на старом домене → DOWN с момента переезда; Kuma (1.23.x) шлёт алерт ТОЛЬКО на смену статуса UP→DOWN, поэтому реальный аутаж нового сервиса не дал перехода → тишина. Правило: после любого инфра-изменения проверять что мониторы ЗЕЛЁНЫЕ (а не «давно красные»); вечно-красный монитор хуже отсутствующего — даёт ложное чувство покрытия. **(б) Бэкапы и heartbeat-источники сами не переезжают.** На новом сервере не было `/opt/gmd/bin`, systemd-таймеров pg-backup, дампов — БД не бэкапилась 17 дней при внешне «зелёном» сервисе. Скрипты лежали в репо (`infra/server-setup/`, `infra/server/`), их просто не запустили. Правило: post-migration чек-лист — `systemctl list-timers | grep -E 'pg-backup|kuma'`, `/opt/gmd/backups/postgres` непустой, push-мониторы UP. **(в) Доставку алертов проверять сквозным тестом ИЗ компонента-отправителя, а не прокси с хоста.** `sendMessage` с хоста ≠ из контейнера Kuma (разный egress/DNS). Настоящая проверка: временный падающий монитор (http на discard-порт, `maxretries=0`) → дождаться DOWN → убедиться что в логах нет `Cannot send` (Kuma логирует только сбои отправки, успехи молча) → удалить монитор. Прямое продолжение уроков #5/#17 «verification = запустить целиком». **Сопутствующее:** контейнер не достучится до своего же публичного домена (резолв в `127.0.1.1` из /etc/hosts хоста) — нужен `extra_hosts` на реальный IP; `. .env.prod` под `set -u` падает на bcrypt-хешах (`$2y$…`) — source с временно выключенным nounset. Детали — `docs/monitoring.md` + memory-compiler runbook.

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
- `gmd-development` (project-level, [.claude/skills/gmd-development/SKILL.md](.claude/skills/gmd-development/SKILL.md)) — проект, пути, конвенции, dev/prod-команды, common mistakes (auto-load для GMD)
- `superpowers:*` — **только по явному запросу пользователя** (см. «Рабочий процесс»)
- `frontend-design:frontend-design` — UI кабинета родителя, лендинг
- `design:design-system`, `design:accessibility-review`, `design:ux-copy`, `design:design-handoff`
- `chrome-devtools-mcp:chrome-devtools`, `chrome-devtools-mcp:a11y-debugging`, `chrome-devtools-mcp:debug-optimize-lcp`
- `webapp-testing` — Playwright smoke web-кабинета
- `browser-tools` — скриншоты для дизайн-итераций
- `doc-coauthoring` — политика конфиденциальности, EULA, РКН-уведомление
- `anthropic-skills:docx`, `anthropic-skills:pdf` — юр. документы
- `update-config` — хуки, permissions, env
- `gmd-deploy` (project-level, [.claude/skills/gmd-deploy/SKILL.md](.claude/skills/gmd-deploy/SKILL.md)) — полный релизный flow: bump версий, web-deploy, build APK, publish, verify endpoint. Закрывает грабли из lessons #12, #14, #16.
- `gmd-docker-ops` (project-level, [.claude/skills/gmd-docker-ops/SKILL.md](.claude/skills/gmd-docker-ops/SKILL.md)) — compose logs/restart/rebuild/exec для local dev и prod gmd-online. Включает known bug «postgres cold-start fast shutdown».

### Нужно создать (через `anthropic-skills:skill-creator`)

- `gmd-db-backup` — pg_dump + restore + anonymize для dev
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
- ✅ `gmd-taskmaster` — задачи/PRD ([.mcp.json](.mcp.json))
- ✅ `gmd-postgres` — read-only SQL к локальному `gmd_dev` ([.mcp.json](.mcp.json), `@modelcontextprotocol/server-postgres`). Удобно для отладки PostGIS-геометрии, индексов, аналитики локаций без `docker exec`.
- ✅ `filesystem`
- ✅ `chrome-devtools-mcp`, `playwright` — отладка и тесты web
- ✅ `shadcn-ui` — компоненты
- ✅ `context7` — актуальная документация библиотек (Riverpod, Prisma, Next.js, dio, drift, flutter_map и т.п.)
- ⏳ Добавить (когда дойдёт очередь): `github` MCP (PR/issues из чата), GlitchTip/Sentry MCP (prod-ошибки без SSH-туннеля)

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
# Деплой актуального кода на gmd-online (45.67.230.87)
bash infra/deploy/deploy.sh

# Проверки
curl https://gmd-online.ru/api/readyz               # {status:ok,db:up,redis:up}
ssh gmd-online 'docker ps --format "{{.Names}} {{.Status}}"'

# Бэкапы PG (systemd timers)
ssh gmd-online 'systemctl list-timers | grep pg-'
ssh gmd-online 'ls /opt/gmd/backups/postgres/'
```

Сервер доступен по `https://gmd-online.ru/` (DNS A → 45.67.230.87, прямой публичный IP на интерфейсе `ens3`, без NAT). Прежний домен `gmd.link28rus.ru` отвечает 301 редиректом до плановой остановки (90 дней с 2026-05-15).

## RuStore-релизы (`releases/rustore/`)

Single source of truth по AAB-артефактам, отправленным в RuStore Console. Полные правила и реестр версий — [releases/rustore/README.md](releases/rustore/README.md).

**Что лежит:**

```
releases/rustore/
├── README.md   ← реестр опубликованных версий + SHA-256
├── .gitignore  ← *.aab, *.apk (бинарники в git не коммитим)
├── parent/gmd-parent-<X.Y.Z>+<N>.aab
└── child/gmd-child-<X.Y.Z>+<N>.aab
```

**Правила:**

1. **Имя строго `gmd-{parent,child}-<X.Y.Z>+<N>.aab`** — `<X.Y.Z>` из корневого `package.json`, `+<N>` из `apps/mobile-{parent,child}/pubspec.yaml` (`version: X.Y.Z+N`). Это pubspec build, **не** effective versionCode с ABI offset (lesson #14 — ABI offset считает только web-endpoint `/api/public/updates/...`, а в RuStore идёт чистый pubspec build).
2. **AAB не коммитим** (~50 МБ каждый, точно воспроизводимы из коммита через `flutter build appbundle --release`). Локальные копии нужны только чтобы не пересобирать заново перед `Сохранить как черновик` / re-upload в RuStore Console.
3. **Метаданные коммитим** — `README.md` с таблицей версий (дата, версия, versionCode, Console ID, статус «Опубликовано» / «Ожидает модерацию» / «Модерация не пройдена», SHA-256). При каждой подаче — обновлять таблицу в том же коммите, что bump версии и CHANGELOG.
4. **Один keystore = одна подпись = навсегда** (lesson #4 rule). Подпись AAB и self-hosted APK — один и тот же keystore (см. `apps/mobile-{parent,child}/android/key.properties`), иначе пользователь, мигрирующий с self-hosted на RuStore, упрётся в signature mismatch на `adb install -r`. Перед каждой подачей: `jarsigner -verify -verbose -certs <aab>` + сверить SHA-1 с предыдущей версией.
5. **strictly increasing versionCode**. RuStore Console отвергнет AAB с `versionCode ≤ предыдущая`. Bump `+N` в pubspec обязательно перед сборкой; `pnpm version:sync` НЕ трогает `+N`, его инкрементируем вручную.
6. **Real-device smoke test перед upload (БЛОКИРУЮЩИЙ).** До любого `Отправить на модерацию` в RuStore Console — оба apps реально установлены на физическое устройство через `adb install -r` и пройден golden path: parent — логин + карточка ребёнка + карта; child — claim/привязка работает, главный SOS виден, DiagLog без ошибок свежих push/saveNativeCreds. Если хоть один шаг сломан — фиксим, bump `+N+1`, пересобираем, повторяем smoke. Цена отозвать черновик в RuStore ниже чем цена отказа модерации (1-3 дня на каждый круг). Lessons #5 («verification = запустить») и #12 («`adb install -r` после `dumpsys package | grep signatures`») применимы дословно. Чек-лист — в `releases/rustore/README.md` шаг 4.
7. **Workflow подачи** — детали в `releases/rustore/README.md` («Workflow при подаче новой версии»). Обязательно в комментарий модератору при каждом submit: тестовые credentials + long-lived invite (lessons #24 + #26 — иначе default reject).

**Скил `gmd-deploy`** ([.claude/skills/gmd-deploy/SKILL.md](.claude/skills/gmd-deploy/SKILL.md)) пишет AAB в `apps/mobile-{child,parent}/build/app/outputs/bundle/release/app-release.aab` и должен после копировать в `releases/rustore/{parent,child}/` с правильным именем + обновлять `releases/rustore/README.md`.

**Графические assets для RuStore Console — разделены по принципу «brand vs release-specific»:**

```
docs/rustore-assets/                         ← BRAND assets (общие между submission'ами)
├── icon-{parent,child}-512.png              иконка приложения 512×512 (шаг 4 Console)
├── featured-{parent,child}.png              featured-баннер 1024×500 (страница приложения)
└── screenshot-{parent,child}-NN.png         legacy promo 1920×1080 landscape (опц. tablet секция)

releases/rustore/{parent,child}/screenshots/ ← RELEASE assets (по app, в git)
├── parent/screenshots/{parent-NN-descriptor.{jpg,png}}  real-device screencaps 1080×1920 portrait 9:16
└── child/screenshots/{child-NN-descriptor.{jpg,png}}    real-device screencaps 1080×1920 portrait 9:16
```

**Правило брать скрины из своей папки:** при подаче в RuStore Console шаг «Медиа → Скриншоты для телефонов» — берём **строго** из `releases/rustore/{parent,child}/screenshots/`, не из `docs/`, не из временных папок. Это single source of truth, привязанный к release-папке (там же лежит AAB этой версии).

**Требования и обработка скринов:**

- Соотношение строго **9:16 portrait** (рек. 1080×1920) или 16:9 landscape. 1080×2400 (9:20 от современных Android) **не подходит** — режется/отказ модератора (lesson #26).
- Реальные device-screencaps лучше promo-карточек для apps с stalkerware-like permission set (lesson #26: модератор может попросить заменить promo на реальный UI у child).
- **БЛОКИРУЮЩИЙ: перед screencap'ом закрыть все модалы / попапы / notification shade.** В каталоге RuStore первый screen — это preview карточки, и если поверх него висит alert «Не все разрешения активны» или системный popup — пользователь не видит UI app'а, а модератор может посчитать «не работает / зависло». Перед `adb screencap`: нажать «Позже» / «Понятно» на любых модалах, свайпнуть нотификации, дождаться чистого main screen.
- Обработка: `python tools/rustore/process_screenshots.py INPUT releases/rustore/{parent,child}/screenshots/{app}-NN-descriptor.{jpg,png}` (top-bias crop: сохраняет status bar + header, режет нижний system-navbar).
- Имя файла: `{app}-{NN}-{descriptor}.{jpg,png}` — NN определяет showcase в Console (первая = preview в каталоге RuStore).
- Скриншоты коммитим в git (~50-200KB каждый) — при ресабмите переиспользуем, если UI не изменился. AAB — в .gitignore. Полные правила: [releases/rustore/README.md](releases/rustore/README.md) раздел «Скриншоты для RuStore wizard».

## Память и секреты

- Единственная система знаний — `mcp__memory-compiler__*`. Других vault'ов нет.
- `MC_ENCRYPT_KEY` — настроить, чтобы `save_secret` работал (сейчас credentials не шифруются).
- SSH/DB/API-ключи — только в `.env` и зашифрованно в memory-compiler.
- Никаких секретов в git.

## Язык

Общение на русском. Идентификаторы кода, API-названия — английский.
