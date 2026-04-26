# GMD — Phase 6 «Родительский контроль»: статистика экранного времени + блокировка приложений. Дизайн.

**Статус:** Draft
**Дата:** 2026-04-26
**Автор:** link28rus + Claude
**Аналог:** Findmykids «Pingo» / «Где мои дети» «Родительский контроль»
**Связанные:** [MVP-design](2026-04-18-gmd-mvp-design.md), [Phase 3 mobile-child](2026-04-20-gmd-phase3-mobile-child-design.md), [Sound Around](2026-04-23-gmd-sound-around-design.md)

---

## 1. Цель и контекст

Дать родителю две связанные функции:

1. **Видеть** — сколько и в каких приложениях ребёнок проводит время (по дням, неделям, по часам), с категоризацией (соцсети / игры / мессенджеры / другое).
2. **Управлять** — нажатием одной кнопки заблокировать все приложения у ребёнка на N времени, кроме явно разрешённых (whitelist) и системных (звонки / СМС / камера / наш app / MAX).

Реализуется как Phase 6 (заранее отнесена туда в [phase3-mobile-child design](2026-04-20-gmd-phase3-mobile-child-design.md)). Поднимается раньше срока — по запросу пользователя 2026-04-26 для feature-parity с конкурентом.

**Платформенный фундамент уже частично есть:**

- AccessibilityService для PIN-lock (v0.27+) — расширим под детектор foreground app.
- Device Admin (v0.28+) — самозащита нашего app.
- Wizard для MIUI/HyperOS «Ограниченные настройки» — переиспользуем для нового permission.
- FCM high-priority push (v0.37+) — для мгновенной доставки команд BLOCK / UNBLOCK.

## 2. Scope

### В Scope

**v0.38 (Screen-time reporting):**

- Сбор статистики через `UsageStatsManager` на mobile-child (worker раз в 15 мин).
- Backend хранит часовые bucket'ы за 30 дней.
- Web-кабинет родителя: вкладки Сегодня / Вчера / Неделя, график по часам, список приложений с временем + категорией.
- Категоризация: статичный JSON-справочник + fallback «Другое».
- Список установленных приложений с иконками (PNG ~5KB, dedupe по sha256, MinIO).
- Ретроспектива: при первом запуске тянем UsageStats за 7 дней.
- Wizard для grant `PACKAGE_USAGE_STATS` (по аналогии с a11y wizard).

**v0.39 (App blocking core):**

- Backend модели BlockSession, AppRule (per-child whitelist), endpoints CRUD.
- mobile-child: AccessibilityService расширен детектором foreground app + `BlockOverlayActivity` (full-screen с таймером).
- mobile-child: drift-таблицы `app_blocks_local`, `app_rules_local`, sync через FCM `BLOCK_APPS` / `UNBLOCK_APPS`.
- mobile-parent + web-parent: кнопка «Заблокировать», time picker (5 мин..24ч, шаг 5 мин), управление whitelist «Не блокируется».
- Default whitelist (auto-resolved): default dialer + default SMS + default camera + default contacts + Settings + наш app + MAX (`ru.oneme.app`).
- Self-protection: наш app никогда не попадает в blacklist; AccessibilityService ловит попытки force-stop / uninstall.

**v0.40 (Unlock requests + UX polish):**

- Кнопка «Мне очень нужно» на overlay → FCM push родителю + запись `UnlockRequest` в БД.
- Parent UI: список запросов, кнопки «одобрить на 15 мин» / «снять блок полностью» / «отказать».
- «Всегда заблокированы» (постоянное правило, без сессии) — для приложений вроде TikTok всегда выкл, без таймера.

### НЕ в Scope (post-MVP / Phase 7+)

- **Гео-привязка блокировок** («блокировать в школе с 8 до 14»), вкладка «В местах» на скрине конкурента — отложили в v0.41+. Time picker блокирует глобально.
- **Расписание** (например «соцсети с 22:00 до 7:00») — Phase 7.
- **iOS на стороне ребёнка** — нет mobile-child под iOS вообще.
- **Лимиты по времени на приложение** («TikTok максимум 30 мин/день, потом авто-блок») — Phase 7. На MVP только ручная блокировка кнопкой.
- **Снимки экрана / контент-мониторинг** — никогда (152-ФЗ, биометрия, EULA).
- **Бан по контенту YouTube / Chrome** — невозможно без MITM и accessibility-доступа к содержимому, не делаем.

## 3. UX-flow

### 3.1 Parent — экран «Родительский контроль» (web + mobile)

```
[Главная карточка ребёнка] → tap «Родительский контроль»
   ↓
┌─ Вкладки: [Вчера] [Сегодня] [Неделя]
├─ Большая цифра: «11 мин» + ↓95% от обычного
├─ График по часам (24 столбика для день, 7 для недели)
├─ Категории-чипы: «Соцсети 5 мин», «Другое 6 мин» (tap → фильтр списка)
├─ [🔒 Заблокировать приложения] — primary CTA
└─ Sub-tabs: [Все] [В местах*] [Не блокируются (N)] [Всегда заблокированы (M)]
    │
    └─ Список приложений:
        ┌───────────────────────────────────┐
        │ [icon] AppName                  🔓│   ← tap → toggle "не блокируется"
        │        5 мин · Соцсети            │
        └───────────────────────────────────┘
        Иконки замка: 🔓 (default — будет блокирован), 🔒 (всегда блокирован), ∞ (не блокируется)
```

\*«В местах» — disabled заглушка с тултипом «Скоро» (v0.41+).

### 3.2 Parent — диалог блокировки (по скрину пользователя)

```
[🔒 Заблокировать приложения] tap
   ↓
┌──────────────────────────────────────────┐
│ На какой срок хотите заблокировать       │
│ ребёнку приложения?                       │
│                                            │
│ После блокировки на телефоне ребёнка     │
│ станут недоступны все приложения,        │
│ кроме помеченных как «Не блокируется», │
│ а также звонков, СМС, камеры и GMD       │
│                                            │
│  ╔══════════╦══════════╗                  │
│  ║   00     ║   50     ║                  │
│  ║   01     ║   55     ║                  │
│  ║ ▶ 02 ч.  ║ ▶ 00 мин.║                  │
│  ║   03     ║   05     ║                  │
│  ║   04     ║   10     ║                  │
│  ╚══════════╩══════════╝                  │
│                                            │
│        [   Заблокировать   ]              │
└──────────────────────────────────────────┘

Range: 5 мин .. 24 ч, шаг 5 мин (минуты), 1 ч (часы)
Default: 02 ч 00 мин
```

После tap «Заблокировать» — POST на backend, спиннер 1-3 сек (FCM-доставка), затем экран меняется на:

```
🔒 Блокировка активна
Осталось: 1 ч 59 мин
[Снять блокировку]
```

### 3.3 Child — экран overlay при попытке открыть заблокированное

Точная копия скрина пользователя:

```
┌──────────────────────────────────────┐
│                                      │
│         [Иллюстрация: пингвин        │
│          с замком]                   │
│                                      │
│  Твой телефон заблокирован           │
│  ещё на 1 ч 59 мин                   │
│                                      │
│  Если очень нужно, нажми кнопку,    │
│  чтобы попросить родителей          │
│  разблокировать                      │
│                                      │
│  ⌒ taps на бэкграунд блокируются ⌒  │
│                                      │
│  [    Мне очень нужно    ]          │
│  [        Закрыть         ]          │
└──────────────────────────────────────┘

Активируется при detect foreground app ∈ blacklist (всё кроме whitelist + системных).
Кнопка «Закрыть» → Intent.ACTION_MAIN + CATEGORY_HOME → launcher.
Кнопка «Мне очень нужно» → POST /unlock-request → toast «Родитель уведомлён», возврат на launcher.
```

## 4. Архитектура

### 4.1 Компоненты

```
┌─────────────┐         ┌──────────────────┐
│ web/mobile  │ ←─REST──│  backend (NestJS)│
│ parent      │         │  - app-control   │
└─────────────┘         │    sessions      │
                        │  - app rules     │
                        │  - usage reports │
                        │  - icons (MinIO) │
                        └──┬────────┬──────┘
                           │        │
                           │ FCM    │
                           │ push   │
                           ↓        │
                  ┌──────────────────┐
                  │   mobile-child   │
                  │  ┌────────────┐  │
                  │  │ a11y svc   │──→ детект foreground
                  │  │ + overlay  │     │
                  │  └────────────┘     ↓
                  │  ┌────────────┐  BlockOverlayActivity
                  │  │ usage      │
                  │  │ worker     │──→ POST /usage-reports
                  │  │ (15-min)   │
                  │  └────────────┘
                  │  ┌────────────┐
                  │  │ apps       │──→ POST /installed-apps + icons
                  │  │ inventory  │
                  │  └────────────┘
                  └──────────────────┘
```

### 4.2 Sequence — блокировка

```
parent              backend          FCM             child a11y      child overlay
  │                    │              │                  │              │
  │─POST block-session─▶              │                  │              │
  │ {durationMin: 120} │              │                  │              │
  │                    │─INSERT BlockSession             │              │
  │                    │  state=ACTIVE, endsAt=+2h       │              │
  │                    │─push "BLOCK_APPS"───▶ data{ses, endsAt}        │
  │◀─201 {sessionId}───│              │                  │              │
  │                    │              │                  │              │
  │                    │              │  ┌──FCM-data───▶│              │
  │                    │              │  │ MyFirebase   │              │
  │                    │              │  │  Messaging   │              │
  │                    │              │  │ Service      │              │
  │                    │              │  └──INSERT local │              │
  │                    │              │     app_block    │              │
  │                    │              │                  │              │
  │                    │              │   user opens TikTok              │
  │                    │              │                  │─detect "com.zhiliaoapp.musically"
  │                    │              │                  │─in blacklist? YES
  │                    │              │                  │─launch overlay──▶│
  │                    │              │                  │              │  show timer
  │                    │              │                  │              │  countdown
  │                    │              │                  │              │
  │ user wants to stop early                                            │
  │─DELETE block-session/:id          │                  │              │
  │                    │─UPDATE state=ENDED              │              │
  │                    │─push "UNBLOCK_APPS"─────────────▶│             │
  │◀─204───────────────│              │                  │              │
  │                    │              │                  │─clear local │
  │                    │              │                  │  app_block   │
  │                    │              │                  │─finish overlay──▶│
```

### 4.3 Sequence — usage report

```
child (worker, every 15 min)        backend
  │                                    │
  │─query UsageStatsManager           │
  │  INTERVAL_DAILY today             │
  │  + queryEvents для bucket'ов      │
  │  по часам                          │
  │                                    │
  │─aggregate per package per hour    │
  │                                    │
  │─POST /child/usage-reports───────▶ │
  │  { date, tz, buckets: [           │
  │     {hour:14, pkg:"com.tiktok",   │
  │      seconds: 245}, ...] }         │
  │                                    │─UPSERT usage_buckets
  │                                    │  (childDeviceId, date, hour, pkg)
  │◀─204 ──────────────────────────── │
```

## 5. Модели данных (Prisma)

```prisma
// Список установленных приложений у ребёнка (snapshot, обновляется ежедневно).
model InstalledApp {
  id                String        @id @default(cuid())
  childDeviceId     String
  childDevice       ChildDevice   @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)

  packageName       String        // "com.zhiliaoapp.musically"
  appLabel          String        // "TikTok"
  iconSha256        String?       // ссылка на app_icons.sha256
  isSystem          Boolean       @default(false)  // ApplicationInfo.FLAG_SYSTEM
  category          String?       // resolved через app_categories.json: "social" | "games" | "messengers" | "other"

  firstSeenAt       DateTime      @default(now())
  lastSeenAt        DateTime      @default(now())  // обновляется при каждом sync

  @@unique([childDeviceId, packageName])
  @@index([childDeviceId])
}

// Глобальный кэш иконок (dedupe по sha256).
model AppIcon {
  sha256            String        @id  // SHA-256 от raw PNG bytes
  s3Key             String        // ключ в MinIO
  bytes             Int
  createdAt         DateTime      @default(now())
}

// Per-child правила: для каких apps снимаем default-блокировку.
model AppRule {
  id                String        @id @default(cuid())
  childDeviceId     String
  childDevice       ChildDevice   @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)

  packageName       String
  mode              AppRuleMode   // ALWAYS_ALLOWED (whitelist) | ALWAYS_BLOCKED (постоянный блок) | DEFAULT
  source            AppRuleSource // PARENT | SYSTEM_DEFAULT (резолвлено child'ом)

  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  @@unique([childDeviceId, packageName])
}

enum AppRuleMode {
  DEFAULT          // подчиняется блок-сессии (= блокируется)
  ALWAYS_ALLOWED   // никогда не блокируется (whitelist)
  ALWAYS_BLOCKED   // блокируется даже без активной сессии (v0.40)
}

enum AppRuleSource {
  PARENT           // родитель явно настроил
  SYSTEM_DEFAULT   // авто-резолвлено (default dialer/sms/camera/contacts/settings)
  HARDCODED        // зашито в backend: ru.link28rus.gmd.child, ru.oneme.app
}

// Активная блокировка.
model BlockSession {
  id                String           @id @default(cuid())
  childDeviceId     String
  childDevice       ChildDevice      @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)
  createdByParentId String
  createdByParent   User             @relation(fields: [createdByParentId], references: [id])

  state             BlockSessionState
  startedAt         DateTime         @default(now())
  endsAt            DateTime         // startedAt + durationMin
  endedAt           DateTime?        // фактическое (early stop)
  endReason         BlockEndReason?

  @@index([childDeviceId, state])
  @@index([endsAt])  // для cron auto-expire
}

enum BlockSessionState {
  ACTIVE
  ENDED
  EXPIRED          // auto-expired по endsAt
}

enum BlockEndReason {
  PARENT_STOPPED
  EXPIRED
  UNLOCK_APPROVED  // v0.40
}

// v0.40
model UnlockRequest {
  id                String       @id @default(cuid())
  blockSessionId    String
  blockSession      BlockSession @relation(fields: [blockSessionId], references: [id], onDelete: Cascade)
  packageName       String?      // какое приложение пытались открыть (опц.)
  requestedAt       DateTime     @default(now())

  decidedAt         DateTime?
  decidedByParentId String?
  decision          UnlockDecision?
  decisionGraceMin  Int?         // если APPROVED_TEMPORARY — на сколько минут разблокировано
}

enum UnlockDecision {
  APPROVED_TEMPORARY  // разблокировать на N мин
  APPROVED_FULL       // снять весь BlockSession
  REJECTED
}

// Часовые bucket'ы использования. Retention 30 дней (pg_cron).
model UsageBucket {
  id                String       @id @default(cuid())
  childDeviceId     String
  childDevice       ChildDevice  @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)

  date              DateTime     @db.Date  // local-date в TZ ребёнка
  hour              Int          // 0..23
  packageName       String
  seconds           Int          // суммарно в этом часе

  @@unique([childDeviceId, date, hour, packageName])
  @@index([childDeviceId, date])
}
```

**Расширение существующей `ChildDevice`:**

```prisma
model ChildDevice {
  // ... existing fields ...

  timezone          String?      // "Europe/Moscow" — для группировки UsageBucket
  installedApps     InstalledApp[]
  appRules          AppRule[]
  blockSessions     BlockSession[]
  usageBuckets      UsageBucket[]
}
```

## 6. API

### 6.1 Child API (mobile-child → backend)

```
POST /child/installed-apps                       Body: { apps: [{packageName, appLabel, isSystem, iconSha256}] }
                                                 Backend UPSERT InstalledApp + lastSeenAt = now.
                                                 Apps, отсутствующие в payload, помечаются deleted (soft) или TTL 7 дней.

POST /child/app-icons                            multipart: { files[]: PNG (sha256 в filename) }
                                                 Backend проверяет AppIcon по sha256, скипает существующие, заливает новые в MinIO.

POST /child/usage-reports                        Body: { date: "2026-04-26", tz: "Europe/Moscow",
                                                          buckets: [{hour:14, pkg:"...", seconds:245}, ...] }
                                                 UPSERT UsageBucket по (child, date, hour, pkg).

GET  /child/app-rules                            Returns: { rules: [{packageName, mode, source}] }
                                                 Child тянет при старте + раз в 6ч + по FCM SYNC_RULES.

GET  /child/active-block                         Returns: 200 {sessionId, endsAt} | 204 if нет.
                                                 Child тянет при старте + раз в час + по FCM BLOCK_APPS / UNBLOCK_APPS.

POST /child/block-sessions/:id/unlock-request    v0.40. Body: { packageName? }
                                                 Returns: 201 {requestId}
```

### 6.2 Parent API (web/mobile-parent → backend)

```
GET  /children/:id/installed-apps                Returns: [{packageName, appLabel, iconUrl, category, isSystem,
                                                            currentMode (computed: rule.mode || DEFAULT),
                                                            lastSeenAt, todaySeconds}]

GET  /children/:id/usage                         Query: ?range=day|week&date=YYYY-MM-DD
                                                 Returns: { totalSeconds, byHour[24], byPackage[],
                                                             byCategory: {social, games, messengers, other},
                                                             vsAverage: -95 }

PUT  /children/:id/app-rules/:packageName        Body: { mode: "DEFAULT" | "ALWAYS_ALLOWED" | "ALWAYS_BLOCKED" }
                                                 Triggers FCM SYNC_RULES.

POST /children/:id/block-sessions                Body: { durationMin: 120 }    (5..1440)
                                                 Returns: 201 {sessionId, endsAt}
                                                 Validates: no other ACTIVE session.
                                                 Triggers FCM BLOCK_APPS.

GET  /children/:id/block-sessions/active         Returns: 200 {sessionId, endsAt, startedAt} | 204

DELETE /children/:id/block-sessions/:id          Returns: 204
                                                 Sets state=ENDED, endReason=PARENT_STOPPED.
                                                 Triggers FCM UNBLOCK_APPS.

GET  /children/:id/unlock-requests               v0.40. Query: ?status=pending|all
POST /children/:id/unlock-requests/:id/decide    v0.40. Body: { decision, graceMin? }
```

### 6.3 FCM-команды (новые типы поверх существующего message bus)

| Тип              | Когда                                | Payload                           | Действие в child                                                                      |
| ---------------- | ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------- |
| `BLOCK_APPS`     | POST block-session created           | `{sessionId, endsAt}`             | Записать в Drift `app_blocks_local`, активировать a11y-детектор                       |
| `UNBLOCK_APPS`   | DELETE block-session или auto-expire | `{sessionId}`                     | Очистить `app_blocks_local`, убрать overlay если открыт                               |
| `SYNC_RULES`     | PUT app-rule                         | `{ruleVersion}`                   | Pull `GET /child/app-rules`, обновить `app_rules_local`                               |
| `UNLOCK_DECIDED` | v0.40, parent одобрил/отказал        | `{requestId, decision, graceMin}` | Если APPROVED_TEMPORARY — снять блок на N мин (overlay не показывать в течение grace) |

Fallback при потере push'а: child раз в 60 сек дёргает `GET /child/active-block` (как сейчас audio poll).

## 7. mobile-child: реализация ключевых компонентов

### 7.1 UsageStatsWorker (Kotlin, WorkManager 15-min periodic)

```kotlin
class UsageStatsWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  override suspend fun doWork(): Result {
    if (!hasUsageStatsPermission()) return Result.success()  // tracked в SharedPreferences

    val tz = TimeZone.getDefault().id
    val today = LocalDate.now()
    val buckets = collectHourlyBuckets(today)  // queryEvents для точности
    val payload = UsageReportPayload(date = today, tz = tz, buckets = buckets)
    childApi.postUsageReport(payload)
    return Result.success()
  }
}

private fun collectHourlyBuckets(date: LocalDate): List<HourlyBucket> {
  val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
  val start = date.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
  val end = System.currentTimeMillis()

  val events = usm.queryEvents(start, end)
  val ev = UsageEvents.Event()
  val perHourPerPkg = mutableMapOf<Pair<Int, String>, Long>()  // (hour, pkg) → ms
  val openMap = mutableMapOf<String, Long>()  // pkg → openedAt

  while (events.hasNextEvent()) {
    events.getNextEvent(ev)
    when (ev.eventType) {
      UsageEvents.Event.ACTIVITY_RESUMED -> openMap[ev.packageName] = ev.timeStamp
      UsageEvents.Event.ACTIVITY_PAUSED -> {
        val openedAt = openMap.remove(ev.packageName) ?: return@when
        accumulate(perHourPerPkg, ev.packageName, openedAt, ev.timeStamp)
      }
    }
  }
  return perHourPerPkg.map { (key, ms) -> HourlyBucket(key.first, key.second, (ms / 1000).toInt()) }
}
```

### 7.2 InstalledAppsWorker (Kotlin, daily)

Шлёт snapshot всех `PackageManager.getInstalledApplications(MATCH_ALL)`. Для каждого нового пакета (не было в prev snapshot) — резолвит иконку через `PackageManager.getApplicationIcon`, конвертит в PNG ≤96x96, считает sha256. Если sha256 ещё не отправлялся — заливает через `POST /child/app-icons`.

Резолвит system defaults и шлёт как часть payload:

```kotlin
val defaults = SystemDefaults(
  dialer = telecomManager.defaultDialerPackage,
  sms = Telephony.Sms.getDefaultSmsPackage(ctx),
  camera = pm.queryIntentActivities(Intent(MediaStore.ACTION_IMAGE_CAPTURE), 0).firstOrNull()?.activityInfo?.packageName,
  contacts = pm.resolveActivity(Intent(Intent.ACTION_VIEW).setType("vnd.android.cursor.dir/contact"), 0)?.activityInfo?.packageName,
  settings = "com.android.settings",
)
```

Backend на основе payload УПСЕРТит AppRule с `source=SYSTEM_DEFAULT, mode=ALWAYS_ALLOWED` для всех резолвленных + hardcoded `ru.link28rus.gmd.child` + `ru.oneme.app`.

### 7.3 AccessibilityService — расширение

Существующий `GmdAccessibilityService` (используется для PIN-lock) добавляет:

```kotlin
override fun onAccessibilityEvent(event: AccessibilityEvent) {
  // ... existing PIN-lock logic ...

  if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
    val pkg = event.packageName?.toString() ?: return
    if (pkg == applicationContext.packageName) return  // self
    if (BlockManager.isBlocked(pkg)) {
      val intent = Intent(this, BlockOverlayActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra("packageName", pkg)
      startActivity(intent)
    }
  }
}

object BlockManager {
  fun isBlocked(pkg: String): Boolean {
    val activeBlock = AppBlockDb.getActiveBlock() ?: return false  // нет активной сессии
    if (activeBlock.endsAt < System.currentTimeMillis()) {
      AppBlockDb.clearActiveBlock()  // expired
      return false
    }
    val rule = AppBlockDb.getRule(pkg)
    return when (rule?.mode) {
      "ALWAYS_ALLOWED" -> false
      "ALWAYS_BLOCKED" -> true  // блокируется даже без сессии (v0.40)
      else -> true  // DEFAULT в активной сессии = блокировать
    }
  }
}
```

### 7.4 BlockOverlayActivity

```kotlin
class BlockOverlayActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                  or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                  or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                  or WindowManager.LayoutParams.FLAG_FULLSCREEN)
    setShowWhenLocked(true)
    setContent { BlockOverlayScreen(endsAt = intent.getLongExtra("endsAt", 0)) }
  }

  override fun onBackPressed() { /* swallow */ }
  override fun onPause() { super.onPause(); finish() }  // если ушёл — пусть a11y перезапустит
}
```

«Закрыть» → `Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)`.
«Мне очень нужно» → POST + toast + Home (v0.40).

### 7.5 FCM handler

Расширение существующего `MyFirebaseMessagingService` (v0.37):

```kotlin
when (data["type"]) {
  "START_AUDIO" -> ...           // existing
  "STOP_AUDIO" -> ...            // existing
  "BLOCK_APPS" -> handleBlockApps(data)
  "UNBLOCK_APPS" -> handleUnblockApps()
  "SYNC_RULES" -> handleSyncRules()
  "UNLOCK_DECIDED" -> handleUnlockDecided(data)  // v0.40
}
```

## 8. Платформенные подводные камни

### 8.1 Permissions

| Permission                   | Тип     | Гранится                                         | Влияние без него                                    |
| ---------------------------- | ------- | ------------------------------------------------ | --------------------------------------------------- |
| `PACKAGE_USAGE_STATS`        | special | Settings → Special access → Usage data           | Статистика пустая                                   |
| `BIND_ACCESSIBILITY_SERVICE` | service | Settings → Accessibility (уже есть для PIN-lock) | Блокировка не работает                              |
| `SYSTEM_ALERT_WINDOW`        | special | Settings → Display over apps                     | Overlay не запускается на Android 10+ из background |
| `FOREGROUND_SERVICE`         | normal  | Manifest                                         | —                                                   |
| `RECEIVE_BOOT_COMPLETED`     | normal  | Manifest (уже есть)                              | После reboot нет авто-перезапуска worker'ов         |

**Wizard:** добавляем 3-й шаг в существующий onboarding (после a11y и device admin) → Usage Stats permission. На MIUI/HyperOS — те же проблемы с «Ограниченными настройками», переиспользуем текст из v0.27.1.

### 8.2 OEM-specifics

- **MIUI/HyperOS** — «Ограниченные настройки» блокируют PACKAGE_USAGE_STATS для sideload. Wizard: «Карточка приложения → ⋮ → Разрешить ограниченные настройки» (тот же текст что для a11y).
- **MIUI App Info → Combined "Отключить и удалить"** — обходит Device Admin. AccessibilityService уже ловит этот flow для PIN-lock (v0.27+), переиспользуем.
- **Samsung OneUI** — отдельная категория permissions «Apps that can appear on top». Грантим как обычный SYSTEM_ALERT_WINDOW.
- **Honor MagicOS, Tecno HiOS, OPPO ColorOS** — без специфики, стандартный flow.

### 8.3 Bypass-сценарии и митигация

| Сценарий                                                                    | Митигация                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ребёнок открывает заблокированное app, быстро жмёт Home → Recents → возврат | a11y-сервис ловит TYPE_WINDOW_STATE_CHANGED при возврате через Recents → overlay снова появляется                                                                                                    |
| Ребёнок отключает GMD через Settings → Apps → GMD → Force Stop              | Device Admin не разрешает Force Stop. AccessibilityService ловит попытку открыть Settings/<наш package> и показывает overlay (как PIN-lock в v0.27)                                                  |
| Ребёнок снимает Accessibility permission                                    | AccessibilityService не может предотвратить снятие сам себя. Backend получает `lastA11yHeartbeat` (child шлёт каждый час) → если давно не было, шлём родителю push «Защита снята». Уже есть в v0.27. |
| Ребёнок поворачивает время назад                                            | UsageStatsManager не использует system clock напрямую (использует events с monotonic). Block endsAt — UTC от backend, child получает absolute timestamp.                                             |
| Ребёнок открывает app до того, как FCM долетит                              | Latency FCM 3-10 сек (v0.37). Plus poll-fallback каждые 60 сек. Окно неблокирования — до 10 сек после нажатия родителем. Принимаем.                                                                  |

### 8.4 Самозащита

- `ru.link28rus.gmd.child` ВСЕГДА в whitelist (HARDCODED source, нельзя удалить через UI).
- `com.android.settings` ВСЕГДА allowed (иначе wizard не отработает).
- При попытке uninstall/disable нашего app — AccessibilityService показывает PIN-lock (логика из v0.27).

### 8.5 Google Play политика

AccessibilityService для блокировки apps = высокий риск ремува из Play Store. Основной канал распространения — RuStore, политика мягче.

Если выходим в Play — нужен:

- Use Cases form с обоснованием «parental control».
- Prominent disclosure в onboarding.
- Privacy policy секция про Accessibility data (мы её не сохраняем в БД, только используем для детекта).

Откладываем до момента если/когда соберёмся в Play. На MVP RuStore.

## 9. План реализации

### v0.38 — Screen-time reporting (~2 недели)

**Backend:**

- [ ] Prisma: модели `InstalledApp`, `AppIcon`, `UsageBucket`, поле `timezone` в `ChildDevice`. Миграция.
- [ ] `app-control` модуль: контроллер child (`POST installed-apps`, `POST app-icons` multipart, `POST usage-reports`), сервис UPSERT.
- [ ] `app-control` контроллер parent: `GET installed-apps`, `GET usage`. Агрегации (byHour, byCategory, vsAverage = average по последним 7 дням / total today).
- [ ] `app_categories.json` seed: топ-200 RU apps → category. Сервис `CategoryResolver`.
- [ ] Иконки в MinIO bucket `gmd-app-icons`, public-read через presigned URL.
- [ ] pg_cron job: DELETE FROM usage_buckets WHERE date < now()-30d.

**mobile-child:**

- [ ] Permission helper: `hasUsageStatsPermission()` через `AppOpsManager.checkOpNoThrow(OPSTR_GET_USAGE_STATS)`.
- [ ] Wizard step «Usage Stats» (после a11y) — в onboarding и в /debug экране для повторного запроса.
- [ ] `UsageStatsWorker` (WorkManager periodic 15 мин). Ретроспектива 7 дней при первом запуске.
- [ ] `InstalledAppsWorker` (WorkManager daily). Иконки → PNG 96x96 → sha256 → upload только новые.
- [ ] Drift таблица `usage_outbox` (если backend down — копим, шлём при сети).

**web-parent:**

- [ ] Страница `/children/[id]/parental-control` (Next.js App Router).
- [ ] Tabs (Сегодня/Вчера/Неделя), bar chart по часам (recharts), карточки категорий, список apps с иконками.
- [ ] `useUsageQuery({childId, range, date})` — TanStack Query.

**mobile-parent:**

- [ ] Экран «Родительский контроль» (тот же UI что web). flutter_charts.

**Тесты:**

- [ ] Unit: `CategoryResolver`, агрегаций, UPSERT bucket'ов.
- [ ] E2E: child устанавливает 5 apps, использует 2 → backend получает корректные buckets → web показывает.

### v0.39 — App blocking core (~2 недели)

**Backend:**

- [ ] Prisma: `AppRule`, `BlockSession`. Миграция.
- [ ] `block-sessions` контроллер parent: `POST` (валидация no-overlap), `DELETE` (UPDATE state=ENDED + FCM UNBLOCK_APPS), `GET active`.
- [ ] `app-rules` контроллер parent: `PUT /:packageName` (UPSERT + FCM SYNC_RULES).
- [ ] Контроллер child: `GET /child/app-rules`, `GET /child/active-block`.
- [ ] FCM сообщения `BLOCK_APPS`/`UNBLOCK_APPS`/`SYNC_RULES` через существующий `FcmService`.
- [ ] OnModuleInit: при старте бэка очищать BlockSession где `endsAt < now()` AND `state=ACTIVE` → `EXPIRED` (по аналогии с AudioService cleanup из v0.37.0-rc.1).
- [ ] pg_cron каждые 60 сек: auto-expire BlockSession где `endsAt < now() AND state=ACTIVE`.

**mobile-child:**

- [ ] Drift таблицы `app_blocks_local`, `app_rules_local`. DAO + sync через REST.
- [ ] `BlockManager` (object) + `AppBlockDb` (Drift wrapper).
- [ ] `MyFirebaseMessagingService` handlers для BLOCK_APPS/UNBLOCK_APPS/SYNC_RULES.
- [ ] AccessibilityService расширение: детект foreground через TYPE_WINDOW_STATE_CHANGED, проверка BlockManager.
- [ ] `BlockOverlayActivity` (Compose): таймер countdown, кнопка «Закрыть» → Home, дисабленная «Мне очень нужно» (для v0.40).
- [ ] System defaults resolver (dialer/sms/camera/contacts) при первом запуске + раз в неделю.
- [ ] Heartbeat a11y: каждый час child шлёт `lastA11yHeartbeat = now()` через POST /child/heartbeat (или присоединяется к существующему).

**web-parent + mobile-parent:**

- [ ] Кнопка «Заблокировать» → диалог с time picker (5..1440 мин, шаг 5).
- [ ] Активная сессия — счётчик, кнопка «Снять блок».
- [ ] Sub-tab «Не блокируется (N)» — список с toggle.
- [ ] Sub-tab «Все» / «Всегда заблокированы (M)» (последний — disabled-стаб для v0.40).

**Тесты:**

- [ ] Unit BlockManager: matrix (rule.mode × session.state × endsAt) → expected.
- [ ] Integration: POST block → FCM mock → child Drift state.
- [ ] Manual на 12T Pro (HyperOS): включить блок → попытка открыть TikTok → overlay → Home → попытка снова → overlay.

### v0.40 — Unlock requests + UX polish (~1 неделя)

**Backend:**

- [ ] `UnlockRequest` model + миграция.
- [ ] `POST /child/block-sessions/:id/unlock-request` + FCM push родителю (новый тип `UNLOCK_REQUESTED`).
- [ ] `POST /children/:id/unlock-requests/:id/decide` (decision + graceMin) + FCM `UNLOCK_DECIDED` ребёнку.
- [ ] При decision=APPROVED_FULL — UPDATE BlockSession state=ENDED, endReason=UNLOCK_APPROVED.
- [ ] При decision=APPROVED_TEMPORARY — child хранит локально grace до `requestedAt + graceMin`, не показывает overlay для requested package в этот период.

**mobile-child:**

- [ ] Кнопка «Мне очень нужно» в overlay — активна, шлёт unlock-request.
- [ ] Toast «Родитель уведомлён».
- [ ] Handler `UNLOCK_DECIDED` — apply grace или unblock.

**parent UI:**

- [ ] Push notification «Тимоха просит разблокировать TikTok» с deeplink.
- [ ] Список pending unlock-requests на странице блокировки.
- [ ] Action sheet: «Разблокировать на 15 мин / Снять блок полностью / Отказать».

**+ Постоянные правила:**

- [ ] Mode `ALWAYS_BLOCKED` в AppRule. UI: на «Все» добавляем третье состояние замка 🔒.
- [ ] BlockManager учитывает ALWAYS_BLOCKED даже без активной сессии.
- [ ] Sub-tab «Всегда заблокированы (M)».

## 10. Открытые вопросы

1. **Heartbeat endpoint** — добавить общий `POST /child/heartbeat` ({lastA11yHeartbeat, lastUsageStatsCheck, ...}) или прицепить к существующему location-pulse? Решим в начале v0.39.
2. **Иконки в web** — отдавать через CDN MinIO напрямую (presigned URL с TTL 24ч) или через API-proxy `/icons/:sha256`? Скорее всего presigned проще.
3. **Время в приложении при блокировке** — считать ли время потраченное на overlay как «GMD»? Думаю нет — overlay время игнорируем в UsageStats.
4. **TZ ребёнка меняется (поездки)** — UsageBucket date по child-local-TZ, парент видит «Сегодня» в TZ ребёнка или своей? Конкурент скорее всего показывает в TZ ребёнка (натуральнее). Подтвердить с пользователем перед v0.38.
5. **Default categorization** — какие категории показываем как чипы? Фикс: «Соцсети, Игры, Мессенджеры, Видео, Браузеры, Другое» или динамика по top-3? Зафиксировать в seed.
6. **Лимит размера icon-PNG** — 96x96 RGBA = ~37KB worst case. Предел приёма на бэке — 100KB на иконку, 500 иконок на child max.
7. **«Мне очень нужно» rate-limit** — чтобы ребёнок не спамил родителя. Думаю: max 3 запроса на BlockSession.

---

## Связанные решения / lessons (из memory-compiler)

- Сразу делаем FCM с poll-fallback (v0.37 lessons): один канал доставки = single point of failure.
- `OnModuleInit cleanup` обязателен (v0.37.0-rc.1 lesson по AudioSession): любой setTimeout/scheduled state переживает рестарт только если есть startup reconciliation.
- AccessibilityService self-defense (v0.27+ lessons по Task #53): расширение существующего сервиса, не новый — иначе MIUI получает 2 a11y-сервиса от одного app, что повышает шанс отзыва пользователем.
- OEM wizard единый flow (v0.27.1+ lesson): не плодим отдельные экраны для каждого permission, делаем серию шагов в одном wizard'е.
- UI-индикатор состояния (v0.29.4 lesson): на главном экране parent — всегда видимое «Защита включена / Блокировка активна / Защита снята» — без этого пользователь не понимает что происходит.
