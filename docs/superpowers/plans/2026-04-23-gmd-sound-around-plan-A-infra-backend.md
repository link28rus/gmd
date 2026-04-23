# «Звук вокруг ребёнка» — Plan A: Infra (coturn) + Backend (sessions API + signaling)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять TURN-сервер (coturn) и реализовать backend для аудиомониторинга: REST API для signaling, БД-схему сессий, аудит-журнал, доставку аудио-команд на child через существующий short-poll механизм DeviceCommand.

**Architecture:** Сессия живёт в Postgres (`audio_sessions`), state-machine `PENDING→READY→ACTIVE→ENDED|FAILED|EXPIRED`. Parent шлёт REST-запросы (`POST /audio/sessions`, `/answer`, `/ice`, `/stop`); child получает команду через существующий `GET /child/commands/pending` (новый тип `START_AUDIO` с `payload.sessionId`); ICE/SDP exchange — через REST + SSE для parent. coturn даёт NAT-traversal с per-session HMAC-SHA1 кредами TTL=10 мин. Аудит — отдельная таблица `audio_audit_log` (1 год retention под compliance).

**Tech Stack:** NestJS 10, Prisma 5, Postgres 16, Redis (ratelimits), `coturn` 4.6 в docker, Zod (DTO), `@nestjs/throttler`, `@nestjs/event-emitter` (для SSE).

**Spec:** [docs/superpowers/specs/2026-04-23-gmd-sound-around-design.md](../specs/2026-04-23-gmd-sound-around-design.md)

**MVP-trade-off (зафиксировано здесь, не в spec):**

> На MVP **нет FCM**. Аудио-команда доставляется через существующий short-polling DeviceCommand (≈ 2/мин при активном child). Latency между «parent нажал» и «child включил микрофон» = 0-30 сек (худший случай). Это приемлемо: у Findmykids в killed-state такая же картина. После MVP — добавить FCM как Phase 5.0 для latency 0-2 сек. Никакой WebSocket на сервере (CLAUDE.md).

---

## File Structure

**Создаём:**

- `infra/docker/coturn/turnserver.conf` — конфиг coturn
- `apps/backend/src/audio/audio.module.ts`
- `apps/backend/src/audio/audio.service.ts` — бизнес-логика, state-machine, TURN-creds
- `apps/backend/src/audio/audio.events.ts` — `EventEmitter`-based pub/sub для SSE
- `apps/backend/src/audio/dto/audio.dto.ts` — Zod-схемы
- `apps/backend/src/audio/parent-audio.controller.ts` — REST для parent
- `apps/backend/src/audio/child-audio.controller.ts` — REST для child
- `apps/backend/src/audio/audio-admin.controller.ts` — admin endpoints
- `apps/backend/src/audio/audio.service.spec.ts` — unit
- `apps/backend/src/audio/parent-audio.controller.spec.ts` — integration через supertest
- `apps/backend/src/audio/child-audio.controller.spec.ts` — integration
- `apps/backend/prisma/migrations/<ts>_audio_sessions/migration.sql`

**Модифицируем:**

- `infra/docker/docker-compose.dev.yml` — добавить service `coturn`
- `infra/docker/docker-compose.prod.yml` — добавить service `coturn`
- `apps/backend/prisma/schema.prisma` — модели `AudioSession`, `AudioAuditLog`, enum'ы; AppSetting seed audio.\* в AppSettingsService
- `apps/backend/src/app.module.ts` — подключить `AudioModule`
- `apps/backend/src/app-settings/app-settings.service.ts` — `SETTINGS_KEYS.AUDIO_*`, seed, KEY_BOUNDS
- `apps/backend/src/device-commands/device-commands.service.ts` — метод `enqueueAudioStart(deviceId, sessionId, turnCreds)`, `enqueueAudioStop(deviceId, sessionId)`
- `apps/backend/prisma/schema.prisma` — `DeviceCommandType` enum: `+ START_AUDIO`, `+ STOP_AUDIO`
- `apps/backend/src/admin/admin.module.ts` — wire `AudioAdminController` (если будет жить в admin) ИЛИ wired внутри `AudioModule`
- `infra/docker/postgres/20-retention.sql` — pg_cron для `audio_sessions` (90д) + `audio_audit_log` (365д)
- `apps/backend/.env` + `.env.example` — `TURN_SHARED_SECRET`, `TURN_PUBLIC_HOST`, `TURN_PUBLIC_PORT`, `TURN_REALM`
- `infra/docker/.env.dev.example` + `.env.prod.example` — те же переменные

**Out of scope (для Plans B/C/D/E):**

- WebRTC реализация на mobile-child (Plan B)
- WebRTC у parent (Plan C)
- EULA/claim-invite consent UI (Plan D)
- E2E + OEM verification (Plan E)

---

## Phase 5.1: coturn (TURN-сервер)

### Task 1: coturn в dev docker-compose

**Files:**

- Create: `infra/docker/coturn/turnserver.conf`
- Modify: `infra/docker/docker-compose.dev.yml`
- Modify: `infra/docker/.env.dev.example`

- [ ] **Step 1.1: Создать конфиг coturn**

Create `infra/docker/coturn/turnserver.conf`:

```
# coturn config — GMD «Звук вокруг ребёнка»
# Documentation: https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf
#
# Auth — REST API (RFC 5766). Backend генерирует:
#   username = <unix_ts_expiry>:<session_id>
#   password = base64(HMAC_SHA1(static-auth-secret, username))
# coturn проверяет HMAC локально, в БД ходить не надо.

listening-port=3478
tls-listening-port=5349

# В dev слушаем все интерфейсы; в prod ограничим IP при необходимости.
listening-ip=0.0.0.0

# Для NAT-traversal coturn нужно знать свой публичный IP. В dev — localhost.
external-ip=127.0.0.1

# Auth (RFC 5766 REST). Секрет из env.
use-auth-secret
static-auth-secret=${TURN_SHARED_SECRET}
realm=${TURN_REALM}

# Quota: одна аудио-сессия = ≈ 24 kbps Opus = пренебрежимо. Но защитимся.
total-quota=100
user-quota=4
max-bps=64000

# Relay: запрещаем direct peer-to-peer (force-relay), чтобы не светить parent IP.
no-cli
no-tlsv1
no-tlsv1_1
no-multicast-peers
no-rfc5780
no-stun-backward-compatibility
response-origin-only-with-rfc5780

# Debug
log-file=stdout
verbose
fingerprint
```

- [ ] **Step 1.2: Добавить service в docker-compose.dev.yml**

Modify `infra/docker/docker-compose.dev.yml` — добавить service после `redis`:

```yaml
coturn:
  image: coturn/coturn:4.6
  container_name: gmd-coturn-dev
  network_mode: host
  environment:
    TURN_SHARED_SECRET: ${TURN_SHARED_SECRET:-dev-secret-change-me}
    TURN_REALM: ${TURN_REALM:-gmd.local}
  volumes:
    - ./coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
  command: ['turnserver', '-c', '/etc/coturn/turnserver.conf', '--no-cli']
  restart: unless-stopped
```

> ⚠ `network_mode: host` нужен потому что coturn allocates random UDP ports для relay (range 49152-65535 по умолчанию). Через docker port-mapping это не работает корректно. На Linux host работает; на Mac/Windows dev — есть workarounds (см. `min-port`/`max-port` + проброс).

- [ ] **Step 1.3: Прописать env-переменные**

Modify `infra/docker/.env.dev.example` — добавить:

```env
# coturn (TURN-сервер для «Звук вокруг ребёнка»)
TURN_SHARED_SECRET=dev-secret-change-me
TURN_REALM=gmd.local
TURN_PUBLIC_HOST=127.0.0.1
TURN_PUBLIC_PORT=3478
```

Аналогично в локальной `.env.dev` (если есть — пользователь сам).

- [ ] **Step 1.4: Запустить и проверить**

Run:

```bash
pnpm stack:up
docker logs gmd-coturn-dev | head -20
```

Expected: лог содержит `Listener address requested: 0.0.0.0`, `RFC 5766 ALLOCATE` handlers, нет ERROR.

Дополнительно: `docker exec gmd-coturn-dev turnutils_uclient -u test -w fake 127.0.0.1` должен вернуть `401 Unauthorized` (это OK — значит auth работает; правильные креды сгенерим в коде).

- [ ] **Step 1.5: Commit**

```bash
git add infra/docker/coturn/turnserver.conf infra/docker/docker-compose.dev.yml infra/docker/.env.dev.example
git commit -m "feat(infra): coturn TURN-сервер в dev docker-compose"
```

---

### Task 2: coturn в prod docker-compose + проброс UDP

**Files:**

- Modify: `infra/docker/docker-compose.prod.yml`
- Modify: `infra/docker/.env.prod.example`
- Modify: `docs/deploy.md`

- [ ] **Step 2.1: Добавить service в prod compose**

Modify `infra/docker/docker-compose.prod.yml` — добавить после `redis`:

```yaml
  coturn:
    <<: *restart
    image: coturn/coturn:4.6
    container_name: gmd-coturn
    network_mode: host
    environment:
      TURN_SHARED_SECRET: ${TURN_SHARED_SECRET}
      TURN_REALM: ${TURN_REALM:-gmd.link28rus.ru}
    volumes:
      - ./coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
    command: ['turnserver', '-c', '/etc/coturn/turnserver.conf', '--no-cli']
```

- [ ] **Step 2.2: Адаптировать turnserver.conf для prod (external-ip)**

Изменения в `turnserver.conf`: `external-ip` нужно подставлять из env. Заменить hard-coded `127.0.0.1` на `${TURN_EXTERNAL_IP}` и проверить, что coturn умеет это парсить (умеет с 4.5+ при `envsubst`-подходе ИЛИ нужно генерить через entrypoint).

Альтернатива (проще): использовать `--external-ip` через CLI:

Modify `infra/docker/docker-compose.prod.yml`:

```yaml
command:
  - turnserver
  - -c
  - /etc/coturn/turnserver.conf
  - --no-cli
  - --external-ip=${TURN_EXTERNAL_IP}
  - --realm=${TURN_REALM:-gmd.link28rus.ru}
  - --static-auth-secret=${TURN_SHARED_SECRET}
```

И из `turnserver.conf` убрать `external-ip`, `realm`, `static-auth-secret` — они задаются через CLI. Оставшаяся часть конфига общая для dev/prod.

- [ ] **Step 2.3: Env для prod**

Modify `infra/docker/.env.prod.example`:

```env
# coturn
TURN_SHARED_SECRET=GENERATE-ME-WITH-openssl-rand-hex-32
TURN_REALM=gmd.link28rus.ru
TURN_EXTERNAL_IP=95.104.240.99
TURN_PUBLIC_HOST=turn.gmd.link28rus.ru
TURN_PUBLIC_PORT=3478
```

- [ ] **Step 2.4: Документация по проброс портов**

Modify `docs/deploy.md` — добавить раздел «coturn / UDP-портов»:

```markdown
## coturn (TURN для «Звук вокруг»)

coturn слушает на хосте (network_mode: host):

- TCP/UDP **3478** — основной listener
- TCP/UDP **5349** — TLS (опционально, на MVP не используем)
- UDP **49152-65535** — динамический range для relay-сессий

Проброс портов на роутере 95.104.240.99 → 192.168.1.23:

- 3478 TCP+UDP
- 49152-65535 UDP (большой range, иначе сессии не будут устанавливаться через CGNAT)

UFW на сервере:
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49152:65535/udp
```

- [ ] **Step 2.5: Commit**

```bash
git add infra/docker/docker-compose.prod.yml infra/docker/.env.prod.example infra/docker/coturn/turnserver.conf docs/deploy.md
git commit -m "feat(infra): coturn в prod compose + проброс UDP-range"
```

---

## Phase 5.2: Backend audio-sessions API + signaling

### Task 3: Prisma-миграция (модели + индексы + enum'ы)

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`
- Generate: `apps/backend/prisma/migrations/<ts>_audio_sessions/migration.sql`

- [ ] **Step 3.1: Добавить enum-ы и модели в schema.prisma**

Modify `apps/backend/prisma/schema.prisma` — после модели `Trip`, перед `AppSetting`:

```prisma
enum AudioSessionState {
  PENDING
  READY
  ACTIVE
  ENDED
  FAILED
  EXPIRED
}

enum AudioFailureReason {
  PERMISSION_DENIED
  MIC_BUSY
  OEM_BLOCKED
  NETWORK_ERROR
  CHILD_OFFLINE
  PARENT_TIMEOUT
  UNKNOWN
}

enum AudioAuditEvent {
  REQUESTED
  GRANTED
  STARTED
  STOPPED
  FAILED
  EXPIRED
  CONSENT_REVOKED
}

// Сессия аудиомониторинга «Звук вокруг ребёнка». Состояния:
// PENDING — родитель создал, child ещё не подтвердил готовность
// READY   — child прислал SDP-offer, ждём parent answer
// ACTIVE  — обмен ICE состоялся, аудио идёт
// ENDED   — штатное завершение
// FAILED  — ошибка (см. failureReason)
// EXPIRED — child не успел ответить за TIMEOUT_SEC
//
// Аудио НЕ хранится — только метаданные сессии и audit-log. Под 152-ФЗ это
// «обработка без накопления»; согласие фиксируется в ConsentRecord.
model AudioSession {
  id              String              @id @default(cuid())
  childId         String
  childDeviceId   String
  requestedById   String              // userId родителя
  state           AudioSessionState   @default(PENDING)
  hiddenMode      Boolean             @default(true)
  durationSec     Int                 // запрошенная длительность
  actualSec       Int?                // реальная длительность (NULL пока не ENDED)
  failureReason   AudioFailureReason?
  // SDP offer от child / answer от parent — короткие, OK хранить inline.
  sdpOffer        String?
  sdpAnswer       String?
  startedAt       DateTime            @default(now())
  readyAt         DateTime?
  activeAt        DateTime?
  endedAt         DateTime?
  // Billing-заготовка (post-MVP)
  billableMinutes Decimal?            @db.Decimal(5, 2)
  costKopecks     Int?

  child       Child       @relation(fields: [childId], references: [id], onDelete: Cascade)
  childDevice ChildDevice @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)
  requestedBy User        @relation(fields: [requestedById], references: [id], onDelete: Restrict)
  auditLog    AudioAuditLog[]
  iceCandidates AudioIceCandidate[]

  @@index([childId, startedAt(sort: Desc)])
  @@index([requestedById, startedAt(sort: Desc)])
  // Уникальный индекс для concurrentSessionsPerChild=1: одна активная на child.
  @@index([childId, state], map: "audio_sessions_child_active_idx")
  @@map("audio_sessions")
}

// ICE candidates — буфер на случай, если parent SSE дисконнектнулся.
// Прямо отдаём через SSE и параллельно сохраняем; child poll'ит /ice.
model AudioIceCandidate {
  id        String   @id @default(cuid())
  sessionId String
  side      String   // 'parent' | 'child'
  candidate String
  createdAt DateTime @default(now())
  consumed  Boolean  @default(false)

  session AudioSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, side, consumed])
  @@map("audio_ice_candidates")
}

// Аудит для compliance. Retention 1 год (pg_cron). Не CASCADE-удаляется
// вместе с сессией — нужен для последующих юр.запросов.
model AudioAuditLog {
  id          BigInt          @id @default(autoincrement())
  sessionId   String
  event       AudioAuditEvent
  actorUserId String?
  actorIp     String?
  userAgent   String?         @db.VarChar(500)
  metadata    Json?           // дополнительный контекст: failureReason, etc.
  createdAt   DateTime        @default(now())

  session AudioSession @relation(fields: [sessionId], references: [id], onDelete: Restrict)

  @@index([sessionId, createdAt])
  @@map("audio_audit_log")
}
```

Также в моделях `Child`, `ChildDevice`, `User` добавить обратные relations:

```prisma
// внутри model Child:
audioSessions   AudioSession[]
// внутри model ChildDevice:
audioSessions   AudioSession[]
// внутри model User:
audioSessionsRequested AudioSession[]
```

И в enum `DeviceCommandType` добавить:

```prisma
enum DeviceCommandType {
  PLAY_SIGNAL
  START_AUDIO
  STOP_AUDIO
}
```

- [ ] **Step 3.2: Сгенерировать миграцию**

Run:

```bash
pnpm --filter @gmd/backend prisma migrate dev --name audio_sessions
```

Expected: создаётся `apps/backend/prisma/migrations/<ts>_audio_sessions/migration.sql` с CREATE TABLE для `audio_sessions`, `audio_ice_candidates`, `audio_audit_log` + ALTER TYPE для enum'ов + индексы. Prisma Client регенерируется.

- [ ] **Step 3.3: Проверить, что `zones.center_geo` не дропается**

Открыть сгенерированный `migration.sql`. Если есть строка `ALTER TABLE "zones" DROP COLUMN "center_geo"` — удалить (см. комментарий в schema.prisma:386 о PostGIS-ограничении Prisma 5).

Run:

```bash
pnpm --filter @gmd/backend prisma migrate dev
```

Expected: миграция применилась без ошибок. `\d audio_sessions` через `docker exec gmd-postgres-dev psql -U gmd -d gmd_dev -c "\d audio_sessions"` показывает все колонки.

- [ ] **Step 3.4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(backend): Prisma-схема audio_sessions + audio_ice_candidates + audit log"
```

---

### Task 4: AppSettings — ключи `audio.*` + seed

**Files:**

- Modify: `apps/backend/src/app-settings/app-settings.service.ts`
- Modify: `apps/backend/src/app-settings/app-settings.service.spec.ts` (если есть, иначе создать)

- [ ] **Step 4.1: Добавить ключи в SETTINGS_KEYS**

Modify `apps/backend/src/app-settings/app-settings.service.ts:7-21` — расширить `SETTINGS_KEYS`:

```typescript
export const SETTINGS_KEYS = {
  TRIP_IDLE_MINUTES: 'trip.idle_minutes',
  TRIP_IDLE_RADIUS_M: 'trip.idle_radius_m',
  LOCATION_ACCURACY_FLOOR_M: 'location.accuracy_floor_m',
  LOCATION_JITTER_WINDOW_MS: 'location.jitter_window_ms',
  LOCATION_JITTER_MIN_DIST_M: 'location.jitter_min_dist_m',
  SMTP_HOST: 'smtp.host',
  SMTP_PORT: 'smtp.port',
  SMTP_USER: 'smtp.user',
  SMTP_PASS: 'smtp.pass',
  SMTP_FROM: 'smtp.from',
  // Audio (Phase 5.2)
  AUDIO_DEFAULT_DURATION_SEC: 'audio.default_duration_sec',
  AUDIO_MAX_DURATION_SEC: 'audio.max_duration_sec',
  AUDIO_MIN_DURATION_SEC: 'audio.min_duration_sec',
  AUDIO_HIDDEN_MODE_ALLOWED: 'audio.hidden_mode_allowed',
  AUDIO_CHILD_READY_TIMEOUT_SEC: 'audio.child_ready_timeout_sec',
} as const;
```

И KEY_BOUNDS:

```typescript
const KEY_BOUNDS: Record<string, { min: number; max: number }> = {
  [SETTINGS_KEYS.TRIP_IDLE_MINUTES]: { min: 1, max: 180 },
  [SETTINGS_KEYS.TRIP_IDLE_RADIUS_M]: { min: 10, max: 1000 },
  [SETTINGS_KEYS.LOCATION_ACCURACY_FLOOR_M]: { min: 50, max: 500 },
  [SETTINGS_KEYS.LOCATION_JITTER_WINDOW_MS]: { min: 0, max: 300_000 },
  [SETTINGS_KEYS.LOCATION_JITTER_MIN_DIST_M]: { min: 0, max: 200 },
  [SETTINGS_KEYS.SMTP_PORT]: { min: 1, max: 65535 },
  [SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC]: { min: 30, max: 1800 },
  [SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC]: { min: 60, max: 3600 },
  [SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC]: { min: 10, max: 600 },
  [SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC]: { min: 5, max: 120 },
};
```

- [ ] **Step 4.2: Добавить seedAudioIfEmpty()**

Modify `apps/backend/src/app-settings/app-settings.service.ts` — добавить метод в класс:

```typescript
private async seedAudioIfEmpty(): Promise<void> {
  const existing = await this.prisma.appSetting.count({
    where: { key: { startsWith: 'audio.' } },
  });
  if (existing > 0) return;

  const rows: Array<{ key: string; value: string; description: string }> = [
    {
      key: SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC,
      value: '300',
      description:
        'Длительность одной сессии «Звук вокруг» по умолчанию (в секундах). ' +
        '300 = 5 минут. Регулируется родителем при старте сессии в пределах ' +
        '[audio.min_duration_sec, audio.max_duration_sec]. Чем больше — тем выше ' +
        'риск убийства FGS на OEM (Xiaomi, Honor) при экономии батареи. Диапазон: 30-1800.',
    },
    {
      key: SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC,
      value: '1800',
      description:
        'Максимальная длительность одной сессии (в секундах). 1800 = 30 минут. ' +
        'Жёсткий потолок — даже если родитель попросит больше, backend обрежет. ' +
        'Защищает от случайной «вечной» прослушки и экономит батарею ребёнка. Диапазон: 60-3600.',
    },
    {
      key: SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC,
      value: '30',
      description:
        'Минимальная длительность одной сессии (в секундах). Смысла создавать сессию ' +
        'короче нет — handshake WebRTC занимает 1-3 секунды. Диапазон: 10-600.',
    },
    {
      key: SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED,
      value: 'true',
      description:
        'Можно ли использовать скрытый режим (без push/баннера ребёнку). System-level ' +
        'privacy indicator Android всё равно покажется (зелёная точка). Если false — ' +
        'каждая сессия будет уведомлять ребёнка push-уведомлением.',
    },
    {
      key: SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC,
      value: '15',
      description:
        'Таймаут ожидания ответа от child-устройства (в секундах). Если за это время ' +
        'child не прислал SDP-offer — сессия → EXPIRED. Учитывает worst-case для ' +
        'short-poll интервала child (≈ 30 сек) + WebRTC setup (1-3 сек). Диапазон: 5-120.',
    },
  ];

  await this.prisma.$transaction(
    rows.map((r) =>
      this.prisma.appSetting.create({
        data: { ...r, isSecret: false, updatedBy: 'system:seed' },
      }),
    ),
  );
  this.logger.log(`Seeded ${rows.length} audio.* settings with defaults`);
}
```

И в `onModuleInit()` добавить вызов:

```typescript
async onModuleInit(): Promise<void> {
  await this.seedSmtpFromEnvIfEmpty();
  await this.seedLocationFiltersIfEmpty();
  await this.seedAudioIfEmpty();
}
```

- [ ] **Step 4.3: Юнит-тест на seed**

Modify `apps/backend/src/app-settings/app-settings.service.spec.ts` — добавить в существующий `describe`:

```typescript
describe('seedAudioIfEmpty', () => {
  it('seeds 5 audio.* keys when none exist', async () => {
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: 'audio.' } } });
    await service.onModuleInit();
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'audio.' } } });
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.key === 'audio.default_duration_sec')?.value).toBe('300');
  });

  it('idempotent: does not overwrite existing audio.* on second run', async () => {
    await service.update('audio.default_duration_sec', '120', 'test');
    await service.onModuleInit();
    const row = await prisma.appSetting.findUnique({
      where: { key: 'audio.default_duration_sec' },
    });
    expect(row?.value).toBe('120');
  });
});
```

Run:

```bash
pnpm --filter @gmd/backend test app-settings.service.spec
```

Expected: все тесты PASS.

- [ ] **Step 4.4: Commit**

```bash
git add apps/backend/src/app-settings/
git commit -m "feat(backend): app-settings audio.* (default 5 min, max 30 min, hidden_mode)"
```

---

### Task 5: DTO (Zod-схемы) для audio API

**Files:**

- Create: `apps/backend/src/audio/dto/audio.dto.ts`

- [ ] **Step 5.1: Написать схемы**

Create `apps/backend/src/audio/dto/audio.dto.ts`:

```typescript
import { z } from 'zod';

// Parent: создать сессию
export const CreateAudioSessionSchema = z.object({
  childId: z.string().min(1),
  durationSec: z.number().int().positive().optional(), // если не указано — берём из app_settings
  hiddenMode: z.boolean().optional(), // default true
});
export type CreateAudioSessionDto = z.infer<typeof CreateAudioSessionSchema>;

// Parent: ответ с offer
export const ParentAnswerSchema = z.object({
  sdp: z.string().min(1).max(10_000),
});
export type ParentAnswerDto = z.infer<typeof ParentAnswerSchema>;

// Parent / Child: ICE candidate
export const IceCandidateSchema = z.object({
  candidate: z.string().min(1).max(2000),
});
export type IceCandidateDto = z.infer<typeof IceCandidateSchema>;

// Child: prepare offer
export const ChildReadySchema = z.object({
  sdp: z.string().min(1).max(10_000),
});
export type ChildReadyDto = z.infer<typeof ChildReadySchema>;

// Child: error
export const ChildErrorSchema = z.object({
  code: z.enum(['PERMISSION_DENIED', 'MIC_BUSY', 'OEM_BLOCKED', 'NETWORK_ERROR', 'UNKNOWN']),
  message: z.string().max(500).optional(),
});
export type ChildErrorDto = z.infer<typeof ChildErrorSchema>;

// Admin: PATCH audio settings
export const UpdateAudioSettingsSchema = z.object({
  defaultDurationSec: z.number().int().min(30).max(1800).optional(),
  maxDurationSec: z.number().int().min(60).max(3600).optional(),
  minDurationSec: z.number().int().min(10).max(600).optional(),
  hiddenModeAllowed: z.boolean().optional(),
  childReadyTimeoutSec: z.number().int().min(5).max(120).optional(),
});
export type UpdateAudioSettingsDto = z.infer<typeof UpdateAudioSettingsSchema>;

// Response shapes
export interface TurnCreds {
  url: string; // turn:turn.gmd.link28rus.ru:3478
  username: string; // <ts>:<sessionId>
  password: string; // base64(HMAC_SHA1(secret, username))
  ttl: number; // seconds
}

export interface CreateAudioSessionResponse {
  id: string;
  state: 'PENDING';
  expiresAt: string; // ISO
  turnCreds: TurnCreds;
}
```

- [ ] **Step 5.2: Commit**

```bash
git add apps/backend/src/audio/dto/audio.dto.ts
git commit -m "feat(backend): Zod-схемы DTO для audio API"
```

---

### Task 6: AudioService — TURN-creds generator (HMAC-SHA1)

**Files:**

- Create: `apps/backend/src/audio/audio.service.ts` (skeleton + первый метод)
- Create: `apps/backend/src/audio/audio.service.spec.ts`

- [ ] **Step 6.1: Написать failing test**

Create `apps/backend/src/audio/audio.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { AudioService } from './audio.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';
import { AudioEvents } from './audio.events';
import { ConfigService } from '@nestjs/config';

describe('AudioService.generateTurnCreds', () => {
  let svc: AudioService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: {} },
        { provide: AppSettingsService, useValue: {} },
        { provide: DeviceCommandsService, useValue: {} },
        { provide: AudioEvents, useValue: { emitState: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => {
              const env: Record<string, string> = {
                TURN_SHARED_SECRET: 'test-secret-32chars-long-enough!',
                TURN_PUBLIC_HOST: 'turn.example.com',
                TURN_PUBLIC_PORT: '3478',
              };
              return env[k];
            },
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  it('generates RFC 5766-style time-limited creds', () => {
    const sessionId = 'sess_abc123';
    const ttlSec = 600;

    const creds = svc.generateTurnCreds(sessionId, ttlSec);

    expect(creds.url).toBe('turn:turn.example.com:3478');
    expect(creds.username).toMatch(/^\d+:sess_abc123$/);
    const ts = Number(creds.username.split(':')[0]);
    expect(ts).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + ttlSec + 1);
    expect(creds.password).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(creds.ttl).toBe(ttlSec);
  });

  it('produces different passwords for different session ids', () => {
    const a = svc.generateTurnCreds('sess_a', 600);
    const b = svc.generateTurnCreds('sess_b', 600);
    expect(a.password).not.toBe(b.password);
  });
});
```

Run:

```bash
pnpm --filter @gmd/backend test audio.service.spec
```

Expected: FAIL with "Cannot find module './audio.service'" / "AudioService is not defined".

- [ ] **Step 6.2: Минимальная реализация**

Create `apps/backend/src/audio/audio.service.ts`:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';
import { AudioEvents } from './audio.events';
import type { TurnCreds } from './dto/audio.dto';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(DeviceCommandsService) private readonly commands: DeviceCommandsService,
    @Inject(AudioEvents) private readonly events: AudioEvents,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // RFC 5766 REST API for time-limited TURN creds.
  // username = "<unix_ts_expiry>:<session_id>"
  // password = base64(HMAC_SHA1(static-auth-secret, username))
  // coturn проверяет HMAC локально, БД для auth не нужна.
  generateTurnCreds(sessionId: string, ttlSec: number): TurnCreds {
    const secret = this.config.get<string>('TURN_SHARED_SECRET');
    const host = this.config.get<string>('TURN_PUBLIC_HOST');
    const port = this.config.get<string>('TURN_PUBLIC_PORT') ?? '3478';
    if (!secret || !host) {
      throw new Error('TURN_SHARED_SECRET and TURN_PUBLIC_HOST must be configured');
    }
    const expiry = Math.floor(Date.now() / 1000) + ttlSec;
    const username = `${expiry}:${sessionId}`;
    const password = createHmac('sha1', secret).update(username).digest('base64');
    return { url: `turn:${host}:${port}`, username, password, ttl: ttlSec };
  }
}
```

- [ ] **Step 6.3: Прогнать тесты**

Run:

```bash
pnpm --filter @gmd/backend test audio.service.spec
```

Expected: оба теста PASS.

- [ ] **Step 6.4: Создать stub AudioEvents (нужен как DI-зависимость)**

Create `apps/backend/src/audio/audio.events.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface AudioStateEvent {
  sessionId: string;
  state: string;
  data?: unknown;
}

@Injectable()
export class AudioEvents {
  // Один глобальный EventEmitter (in-memory). MVP: один backend-инстанс,
  // SSE-подписчики живут в том же процессе. Multi-instance — Redis Streams в post-MVP.
  private readonly emitter = new EventEmitter();

  emitState(sessionId: string, state: string, data?: unknown): void {
    this.emitter.emit(`session:${sessionId}`, { sessionId, state, data });
  }

  subscribe(sessionId: string, listener: (e: AudioStateEvent) => void): () => void {
    this.emitter.on(`session:${sessionId}`, listener);
    return () => this.emitter.off(`session:${sessionId}`, listener);
  }
}
```

- [ ] **Step 6.5: Commit**

```bash
git add apps/backend/src/audio/audio.service.ts apps/backend/src/audio/audio.service.spec.ts apps/backend/src/audio/audio.events.ts
git commit -m "feat(backend): AudioService skeleton + RFC 5766 TURN-creds generator"
```

---

### Task 7: AudioService.startSession (parent инициирует)

**Files:**

- Modify: `apps/backend/src/audio/audio.service.ts`
- Modify: `apps/backend/src/audio/audio.service.spec.ts`
- Modify: `apps/backend/src/device-commands/device-commands.service.ts`

- [ ] **Step 7.1: Расширить DeviceCommandsService — добавить enqueueAudioStart/Stop**

Modify `apps/backend/src/device-commands/device-commands.service.ts` — добавить методы (имя `createdByUserId` обязательно — поле NOT NULL в `DeviceCommand`, нужно для аудита):

```typescript
import type { TurnCreds } from '../audio/dto/audio.dto';

// Enqueue START_AUDIO для child-устройства. payload содержит sessionId
// и TURN-креды. Child заберёт через next /child/commands/pending poll.
async enqueueAudioStart(
  childDeviceId: string,
  sessionId: string,
  turnCreds: TurnCreds,
  durationSec: number,
  createdByUserId: string,
  ttlMs = 60_000,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await this.prisma.deviceCommand.create({
    data: {
      childDeviceId,
      type: 'START_AUDIO',
      status: 'pending',
      createdByUserId,
      expiresAt,
      payload: { sessionId, turnCreds, durationSec },
    },
  });
}

async enqueueAudioStop(
  childDeviceId: string,
  sessionId: string,
  createdByUserId: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 30_000);
  await this.prisma.deviceCommand.create({
    data: {
      childDeviceId,
      type: 'STOP_AUDIO',
      status: 'pending',
      createdByUserId,
      expiresAt,
      payload: { sessionId },
    },
  });
}
```

- [ ] **Step 7.2: Failing test для startSession**

Add to `apps/backend/src/audio/audio.service.spec.ts`:

```typescript
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';

describe('AudioService.startSession', () => {
  let svc: AudioService;
  let prisma: any;
  let settings: any;
  let commands: any;
  let events: any;

  beforeEach(async () => {
    prisma = {
      child: { findFirst: jest.fn() },
      childDevice: { findFirst: jest.fn() },
      audioSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'sess_new', ...data, startedAt: new Date() }),
          ),
      },
      audioAuditLog: { create: jest.fn() },
    };
    settings = {
      getNumber: jest.fn().mockImplementation((k: string, fb: number) => {
        const map: Record<string, number> = {
          'audio.default_duration_sec': 300,
          'audio.max_duration_sec': 1800,
          'audio.min_duration_sec': 30,
          'audio.child_ready_timeout_sec': 15,
        };
        return Promise.resolve(map[k] ?? fb);
      }),
      getString: jest.fn().mockResolvedValue('true'),
    };
    commands = { enqueueAudioStart: jest.fn() };
    events = { emitState: jest.fn(), subscribe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppSettingsService, useValue: settings },
        { provide: DeviceCommandsService, useValue: commands },
        { provide: AudioEvents, useValue: events },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              (
                ({
                  TURN_SHARED_SECRET: 'secret',
                  TURN_PUBLIC_HOST: 'turn.example.com',
                  TURN_PUBLIC_PORT: '3478',
                }) as Record<string, string>
              )[k],
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  it('throws NotFoundException if child not in family', async () => {
    prisma.child.findFirst.mockResolvedValue(null);
    await expect(
      svc.startSession({
        familyId: 'fam_1',
        userId: 'u_1',
        childId: 'c_x',
        durationSec: 300,
        hiddenMode: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException if no active device', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue(null);
    await expect(
      svc.startSession({
        familyId: 'fam_1',
        userId: 'u_1',
        childId: 'c_1',
        durationSec: 300,
        hiddenMode: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException if active session exists', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });
    prisma.audioSession.findFirst.mockResolvedValue({ id: 'sess_active', state: 'ACTIVE' });
    await expect(
      svc.startSession({
        familyId: 'fam_1',
        userId: 'u_1',
        childId: 'c_1',
        durationSec: 300,
        hiddenMode: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('clamps durationSec into [min, max]', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });
    prisma.audioSession.findFirst.mockResolvedValue(null);

    const r1 = await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 9999,
      hiddenMode: true,
    });
    expect(prisma.audioSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSec: 1800 }),
      }),
    );

    const r2 = await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 5,
      hiddenMode: true,
    });
    expect(prisma.audioSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSec: 30 }),
      }),
    );
  });

  it('creates session, enqueues START_AUDIO command, writes audit, returns turnCreds', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });
    prisma.audioSession.findFirst.mockResolvedValue(null);

    const result = await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 300,
      hiddenMode: true,
      ip: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result).toMatchObject({ state: 'PENDING' });
    expect(result.turnCreds.url).toBe('turn:turn.example.com:3478');
    expect(commands.enqueueAudioStart).toHaveBeenCalledWith(
      'd_1',
      expect.any(String),
      expect.objectContaining({ url: 'turn:turn.example.com:3478' }),
      300,
      'u_1',
      expect.any(Number),
    );
    expect(prisma.audioAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'REQUESTED' }),
      }),
    );
  });
});
```

Run:

```bash
pnpm --filter @gmd/backend test audio.service.spec
```

Expected: все 5 тестов FAIL (метод не существует).

- [ ] **Step 7.3: Реализация startSession**

Modify `apps/backend/src/audio/audio.service.ts` — добавить в класс:

```typescript
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SETTINGS_KEYS } from '../app-settings/app-settings.service';
import type { CreateAudioSessionResponse } from './dto/audio.dto';

interface StartSessionParams {
  familyId: string;
  userId: string;
  childId: string;
  durationSec?: number;
  hiddenMode?: boolean;
  ip?: string;
  userAgent?: string;
}

async startSession(p: StartSessionParams): Promise<CreateAudioSessionResponse> {
  // 1) Проверка доступа: child ∈ family
  const child = await this.prisma.child.findFirst({
    where: { id: p.childId, familyId: p.familyId, deletedAt: null },
  });
  if (!child) {
    throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
  }

  // 2) Активное устройство
  const device = await this.prisma.childDevice.findFirst({
    where: { childId: p.childId, revokedAt: null },
  });
  if (!device) {
    throw new NotFoundException({
      code: 'no_active_device',
      message: 'Child has no active device',
    });
  }

  // 3) Конфликт: уже идёт сессия?
  const existing = await this.prisma.audioSession.findFirst({
    where: { childId: p.childId, state: { in: ['PENDING', 'READY', 'ACTIVE'] } },
  });
  if (existing) {
    throw new ConflictException({
      code: 'session_already_active',
      message: 'Another audio session is already in progress for this child',
      sessionId: existing.id,
    });
  }

  // 4) Settings: clamp durationSec
  const min = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, 30);
  const max = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, 1800);
  const def = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, 300);
  const requested = p.durationSec ?? def;
  const durationSec = Math.max(min, Math.min(max, requested));

  // 5) hiddenMode: проверяем разрешение
  const hiddenAllowed = (await this.settings.getString(SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED, 'true')) === 'true';
  const hiddenMode = (p.hiddenMode ?? true) && hiddenAllowed;

  // 6) Create session
  const readyTimeoutSec = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC, 15);
  const session = await this.prisma.audioSession.create({
    data: {
      childId: p.childId,
      childDeviceId: device.id,
      requestedById: p.userId,
      state: 'PENDING',
      hiddenMode,
      durationSec,
    },
  });

  // 7) TURN-creds (TTL = readyTimeout + duration + buffer)
  const ttl = readyTimeoutSec + durationSec + 60;
  const turnCreds = this.generateTurnCreds(session.id, ttl);

  // 8) Enqueue command
  await this.commands.enqueueAudioStart(device.id, session.id, turnCreds, durationSec, p.userId, readyTimeoutSec * 1000);

  // 9) Audit
  await this.prisma.audioAuditLog.create({
    data: {
      sessionId: session.id,
      event: 'REQUESTED',
      actorUserId: p.userId,
      actorIp: p.ip,
      userAgent: p.userAgent?.slice(0, 500),
      metadata: { durationSec, hiddenMode },
    },
  });

  // 10) Emit state event
  this.events.emitState(session.id, 'PENDING');

  // 11) Schedule expiry timer
  setTimeout(() => this.expireIfStuck(session.id), readyTimeoutSec * 1000);

  return {
    id: session.id,
    state: 'PENDING',
    expiresAt: new Date(Date.now() + readyTimeoutSec * 1000).toISOString(),
    turnCreds,
  };
}

// Если сессия не дошла до READY за readyTimeout — помечаем EXPIRED.
// Идемпотентно — если уже ENDED/FAILED, ничего не делаем.
private async expireIfStuck(sessionId: string): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
  if (!session || session.state !== 'PENDING') return;
  await this.prisma.audioSession.update({
    where: { id: sessionId },
    data: { state: 'EXPIRED', endedAt: new Date(), failureReason: 'PARENT_TIMEOUT' },
  });
  await this.prisma.audioAuditLog.create({
    data: { sessionId, event: 'EXPIRED', metadata: { reason: 'child_no_ready' } },
  });
  this.events.emitState(sessionId, 'EXPIRED');
}
```

Run:

```bash
pnpm --filter @gmd/backend test audio.service.spec
```

Expected: все тесты PASS (8/8).

- [ ] **Step 7.4: Commit**

```bash
git add apps/backend/src/audio/ apps/backend/src/device-commands/device-commands.service.ts
git commit -m "feat(backend): AudioService.startSession + DeviceCommands.enqueueAudioStart/Stop"
```

---

### Task 8: AudioService — child-side ready/answer/ice/error

**Files:**

- Modify: `apps/backend/src/audio/audio.service.ts`
- Modify: `apps/backend/src/audio/audio.service.spec.ts`

- [ ] **Step 8.1: Failing tests**

Add to `apps/backend/src/audio/audio.service.spec.ts`:

```typescript
describe('AudioService child-side', () => {
  let svc: AudioService;
  let prisma: any;
  let events: any;

  beforeEach(async () => {
    prisma = {
      audioSession: {
        findUnique: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      },
      audioAuditLog: { create: jest.fn() },
      audioIceCandidate: { create: jest.fn() },
    };
    events = { emitState: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppSettingsService, useValue: { getNumber: jest.fn(), getString: jest.fn() } },
        { provide: DeviceCommandsService, useValue: {} },
        { provide: AudioEvents, useValue: events },
        { provide: ConfigService, useValue: { get: () => 'x' } },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  it('childReady: PENDING → READY, stores SDP, emits event', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      childDeviceId: 'd1',
      state: 'PENDING',
    });
    await svc.childReady({ sessionId: 's1', deviceId: 'd1', sdpOffer: 'v=0\r\n...' });
    expect(prisma.audioSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { state: 'READY', readyAt: expect.any(Date), sdpOffer: 'v=0\r\n...' },
    });
    expect(events.emitState).toHaveBeenCalledWith('s1', 'READY', { sdp: 'v=0\r\n...' });
  });

  it('childReady: rejects if deviceId mismatch', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      childDeviceId: 'd_other',
      state: 'PENDING',
    });
    await expect(
      svc.childReady({ sessionId: 's1', deviceId: 'd1', sdpOffer: '...' }),
    ).rejects.toThrow(/forbidden/i);
  });

  it('childReady: rejects if state != PENDING', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      childDeviceId: 'd1',
      state: 'ACTIVE',
    });
    await expect(
      svc.childReady({ sessionId: 's1', deviceId: 'd1', sdpOffer: '...' }),
    ).rejects.toThrow(/invalid_state/i);
  });

  it('childError: marks FAILED with reason and emits', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      childDeviceId: 'd1',
      state: 'PENDING',
    });
    await svc.childError({
      sessionId: 's1',
      deviceId: 'd1',
      code: 'PERMISSION_DENIED',
      message: 'mic denied',
    });
    expect(prisma.audioSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'FAILED', failureReason: 'PERMISSION_DENIED' }),
      }),
    );
    expect(events.emitState).toHaveBeenCalledWith('s1', 'FAILED', { reason: 'PERMISSION_DENIED' });
  });

  it('childIce: persists candidate, emits via SSE', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      childDeviceId: 'd1',
      state: 'READY',
    });
    await svc.childIce({ sessionId: 's1', deviceId: 'd1', candidate: 'candidate:1 1 UDP ...' });
    expect(prisma.audioIceCandidate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 's1',
        side: 'child',
        candidate: expect.any(String),
      }),
    });
    expect(events.emitState).toHaveBeenCalledWith('s1', 'ICE', {
      side: 'child',
      candidate: expect.any(String),
    });
  });
});
```

Run:

```bash
pnpm --filter @gmd/backend test audio.service.spec -t 'child-side'
```

Expected: 5 FAILS.

- [ ] **Step 8.2: Реализация**

Add to `apps/backend/src/audio/audio.service.ts` (внутри класса):

```typescript
async childReady(p: { sessionId: string; deviceId: string; sdpOffer: string }): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
  if (!session || session.childDeviceId !== p.deviceId) {
    throw new ForbiddenException({ code: 'forbidden' });
  }
  if (session.state !== 'PENDING') {
    throw new ConflictException({ code: 'invalid_state', state: session.state });
  }
  await this.prisma.audioSession.update({
    where: { id: p.sessionId },
    data: { state: 'READY', readyAt: new Date(), sdpOffer: p.sdpOffer },
  });
  this.events.emitState(p.sessionId, 'READY', { sdp: p.sdpOffer });
}

async childIce(p: { sessionId: string; deviceId: string; candidate: string }): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
  if (!session || session.childDeviceId !== p.deviceId) {
    throw new ForbiddenException({ code: 'forbidden' });
  }
  if (!['PENDING', 'READY', 'ACTIVE'].includes(session.state)) {
    throw new ConflictException({ code: 'invalid_state', state: session.state });
  }
  await this.prisma.audioIceCandidate.create({
    data: { sessionId: p.sessionId, side: 'child', candidate: p.candidate },
  });
  this.events.emitState(p.sessionId, 'ICE', { side: 'child', candidate: p.candidate });
}

async childError(p: {
  sessionId: string;
  deviceId: string;
  code: 'PERMISSION_DENIED' | 'MIC_BUSY' | 'OEM_BLOCKED' | 'NETWORK_ERROR' | 'UNKNOWN';
  message?: string;
}): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
  if (!session || session.childDeviceId !== p.deviceId) {
    throw new ForbiddenException({ code: 'forbidden' });
  }
  if (['ENDED', 'FAILED', 'EXPIRED'].includes(session.state)) {
    return; // идемпотентно
  }
  await this.prisma.audioSession.update({
    where: { id: p.sessionId },
    data: { state: 'FAILED', failureReason: p.code, endedAt: new Date() },
  });
  await this.prisma.audioAuditLog.create({
    data: { sessionId: p.sessionId, event: 'FAILED', metadata: { code: p.code, message: p.message } },
  });
  this.events.emitState(p.sessionId, 'FAILED', { reason: p.code });
}
```

Run:

```bash
pnpm --filter @gmd/backend test audio.service.spec
```

Expected: все тесты PASS.

- [ ] **Step 8.3: Commit**

```bash
git add apps/backend/src/audio/
git commit -m "feat(backend): AudioService child-side (ready/ice/error)"
```

---

### Task 9: AudioService — parent-side answer/ice/stop + auto-active transition

**Files:**

- Modify: `apps/backend/src/audio/audio.service.ts`
- Modify: `apps/backend/src/audio/audio.service.spec.ts`

- [ ] **Step 9.1: Failing tests**

Add to `apps/backend/src/audio/audio.service.spec.ts`:

```typescript
describe('AudioService parent-side', () => {
  let svc: AudioService;
  let prisma: any;
  let events: any;
  let commands: any;

  beforeEach(async () => {
    prisma = {
      audioSession: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ where, data }: any) => ({ id: where.id, ...data })),
      },
      audioAuditLog: { create: jest.fn() },
      audioIceCandidate: { create: jest.fn() },
      child: { findFirst: jest.fn() },
    };
    events = { emitState: jest.fn() };
    commands = { enqueueAudioStop: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppSettingsService, useValue: { getNumber: jest.fn(), getString: jest.fn() } },
        { provide: DeviceCommandsService, useValue: commands },
        { provide: AudioEvents, useValue: events },
        { provide: ConfigService, useValue: { get: () => 'x' } },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  it('parentAnswer: READY → ACTIVE, stores answer, schedules autostop', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      requestedById: 'u1',
      childId: 'c1',
      state: 'READY',
      durationSec: 60,
    });
    prisma.child.findFirst.mockResolvedValue({ id: 'c1', familyId: 'fam1' });

    await svc.parentAnswer({
      sessionId: 's1',
      userId: 'u1',
      familyId: 'fam1',
      sdpAnswer: 'v=0...',
    });

    expect(prisma.audioSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { state: 'ACTIVE', activeAt: expect.any(Date), sdpAnswer: 'v=0...' },
    });
    expect(events.emitState).toHaveBeenCalledWith('s1', 'ACTIVE');
  });

  it('parentAnswer: rejects if state != READY', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      requestedById: 'u1',
      state: 'PENDING',
    });
    await expect(
      svc.parentAnswer({ sessionId: 's1', userId: 'u1', familyId: 'fam1', sdpAnswer: '...' }),
    ).rejects.toThrow(/invalid_state/i);
  });

  it('parentAnswer: rejects if userId != requestedById', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      requestedById: 'u_other',
      state: 'READY',
    });
    await expect(
      svc.parentAnswer({ sessionId: 's1', userId: 'u1', familyId: 'fam1', sdpAnswer: '...' }),
    ).rejects.toThrow(/forbidden/i);
  });

  it('parentStop: ACTIVE → ENDED, computes actualSec, enqueues STOP_AUDIO, emits', async () => {
    const startedAt = new Date(Date.now() - 30_000);
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      requestedById: 'u1',
      childDeviceId: 'd1',
      state: 'ACTIVE',
      activeAt: startedAt,
      durationSec: 60,
    });
    await svc.parentStop({ sessionId: 's1', userId: 'u1', familyId: 'fam1' });
    expect(prisma.audioSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'ENDED', actualSec: expect.any(Number) }),
      }),
    );
    expect(commands.enqueueAudioStop).toHaveBeenCalledWith('d1', 's1', 'u1');
    expect(events.emitState).toHaveBeenCalledWith('s1', 'ENDED');
  });
});
```

Run: `pnpm --filter @gmd/backend test audio.service.spec -t 'parent-side'` → FAIL.

- [ ] **Step 9.2: Реализация**

Add to `audio.service.ts`:

```typescript
async parentAnswer(p: { sessionId: string; userId: string; familyId: string; sdpAnswer: string }): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
  if (!session || session.requestedById !== p.userId) {
    throw new ForbiddenException({ code: 'forbidden' });
  }
  if (session.state !== 'READY') {
    throw new ConflictException({ code: 'invalid_state', state: session.state });
  }
  await this.prisma.audioSession.update({
    where: { id: p.sessionId },
    data: { state: 'ACTIVE', activeAt: new Date(), sdpAnswer: p.sdpAnswer },
  });
  await this.prisma.audioAuditLog.create({
    data: { sessionId: p.sessionId, event: 'STARTED', actorUserId: p.userId },
  });
  this.events.emitState(p.sessionId, 'ACTIVE');

  // Auto-stop через durationSec
  setTimeout(() => this.autoStopIfActive(p.sessionId, p.userId), session.durationSec * 1000);
}

async parentIce(p: { sessionId: string; userId: string; candidate: string }): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
  if (!session || session.requestedById !== p.userId) {
    throw new ForbiddenException({ code: 'forbidden' });
  }
  if (!['READY', 'ACTIVE'].includes(session.state)) {
    throw new ConflictException({ code: 'invalid_state', state: session.state });
  }
  await this.prisma.audioIceCandidate.create({
    data: { sessionId: p.sessionId, side: 'parent', candidate: p.candidate },
  });
  this.events.emitState(p.sessionId, 'ICE', { side: 'parent', candidate: p.candidate });
}

async parentStop(p: { sessionId: string; userId: string; familyId: string }): Promise<void> {
  await this.endSession(p.sessionId, p.userId, 'ENDED');
}

private async endSession(sessionId: string, actorUserId: string, finalState: 'ENDED' | 'FAILED' | 'EXPIRED'): Promise<void> {
  const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  if (['ENDED', 'FAILED', 'EXPIRED'].includes(session.state)) return; // идемпотентно

  const actualSec = session.activeAt
    ? Math.floor((Date.now() - session.activeAt.getTime()) / 1000)
    : 0;
  await this.prisma.audioSession.update({
    where: { id: sessionId },
    data: { state: finalState, endedAt: new Date(), actualSec },
  });
  await this.prisma.audioAuditLog.create({
    data: { sessionId, event: finalState === 'ENDED' ? 'STOPPED' : 'EXPIRED', actorUserId },
  });
  // Сообщаем child закрыть
  if (session.childDeviceId) {
    await this.commands.enqueueAudioStop(session.childDeviceId, sessionId, actorUserId);
  }
  this.events.emitState(sessionId, finalState);
}

private async autoStopIfActive(sessionId: string, userId: string): Promise<void> {
  const s = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
  if (s && s.state === 'ACTIVE') {
    await this.endSession(sessionId, userId, 'ENDED');
  }
}
```

Run: `pnpm --filter @gmd/backend test audio.service.spec` → all PASS.

- [ ] **Step 9.3: Commit**

```bash
git add apps/backend/src/audio/
git commit -m "feat(backend): AudioService parent-side (answer/ice/stop) + auto-stop"
```

---

### Task 10: ParentAudioController (REST)

**Files:**

- Create: `apps/backend/src/audio/parent-audio.controller.ts`
- Create: `apps/backend/src/audio/parent-audio.controller.spec.ts`

- [ ] **Step 10.1: Failing integration test**

Create `apps/backend/src/audio/parent-audio.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AudioModule } from './audio.module';
import { PrismaService } from '../prisma/prisma.service';
import { signAccess } from '../../test/helpers/jwt';
// ... helpers, как в существующих spec'ах (sos.controller.spec.ts и т.п.)

describe('ParentAudioController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parentJwt: string;
  let childId: string;
  let familyId: string;

  beforeAll(async () => {
    // standard test bootstrap — следовать паттерну из других spec'ов
    // (см. apps/backend/src/sos/sos.controller.spec.ts если есть)
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/audio/sessions → 201 PENDING', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/audio/sessions')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ childId, durationSec: 60 })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      state: 'PENDING',
      expiresAt: expect.any(String),
      turnCreds: expect.objectContaining({
        url: expect.stringMatching(/^turn:/),
        username: expect.any(String),
        password: expect.any(String),
        ttl: expect.any(Number),
      }),
    });
  });

  it('POST /api/audio/sessions → 404 if child not in family', async () => {
    await request(app.getHttpServer())
      .post('/api/audio/sessions')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ childId: 'c_nonexistent', durationSec: 60 })
      .expect(404);
  });

  it('POST /api/audio/sessions → 409 if active session exists', async () => {
    // создать одну сессию
    await request(app.getHttpServer())
      .post('/api/audio/sessions')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ childId, durationSec: 60 })
      .expect(201);
    // вторая → 409
    await request(app.getHttpServer())
      .post('/api/audio/sessions')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ childId, durationSec: 60 })
      .expect(409);
  });

  it('POST /sessions/:id/stop → 204 ends', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/audio/sessions')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ childId, durationSec: 60 });
    await request(app.getHttpServer())
      .post(`/api/audio/sessions/${start.body.id}/stop`)
      .set('Authorization', `Bearer ${parentJwt}`)
      .expect(204);
  });
});
```

Run: `pnpm --filter @gmd/backend test parent-audio.controller.spec` → FAIL (controller не существует).

- [ ] **Step 10.2: Controller**

Create `apps/backend/src/audio/parent-audio.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Observable, fromEventPattern, map } from 'rxjs';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AudioService } from './audio.service';
import { AudioEvents } from './audio.events';
import {
  CreateAudioSessionSchema,
  ParentAnswerSchema,
  IceCandidateSchema,
  type CreateAudioSessionDto,
  type ParentAnswerDto,
  type IceCandidateDto,
  type CreateAudioSessionResponse,
} from './dto/audio.dto';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('audio/sessions')
@UseGuards(JwtAuthGuard, ConsentRequiredGuard)
export class ParentAudioController {
  constructor(
    @Inject(AudioService) private readonly svc: AudioService,
    @Inject(AudioEvents) private readonly events: AudioEvents,
  ) {}

  // 6 запусков в минуту — разумный потолок для UX и защита от случайных циклов.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async start(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateAudioSessionSchema)) dto: CreateAudioSessionDto,
  ): Promise<CreateAudioSessionResponse> {
    return this.svc.startSession({
      familyId: req.user.familyId,
      userId: req.user.userId,
      childId: dto.childId,
      durationSec: dto.durationSec,
      hiddenMode: dto.hiddenMode,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async answer(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ParentAnswerSchema)) dto: ParentAnswerDto,
  ): Promise<void> {
    await this.svc.parentAnswer({
      sessionId: id,
      userId: req.user.userId,
      familyId: req.user.familyId,
      sdpAnswer: dto.sdp,
    });
  }

  @Post(':id/ice')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 100 } })
  async ice(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IceCandidateSchema)) dto: IceCandidateDto,
  ): Promise<void> {
    await this.svc.parentIce({ sessionId: id, userId: req.user.userId, candidate: dto.candidate });
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async stop(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.svc.parentStop({
      sessionId: id,
      userId: req.user.userId,
      familyId: req.user.familyId,
    });
  }

  // SSE stream of session events. Парент держит соединение открытым,
  // получает state-changes, SDP-offer, ICE-кандидаты от child.
  @Sse(':id/events')
  events$(@Param('id') id: string): Observable<MessageEvent> {
    return fromEventPattern<{ sessionId: string; state: string; data?: unknown }>(
      (handler) => this.events.subscribe(id, handler),
      (handler, unsub: () => void) => unsub(),
    ).pipe(
      map((e) => ({ data: JSON.stringify({ state: e.state, payload: e.data }) }) as MessageEvent),
    );
  }
}
```

Run: `pnpm --filter @gmd/backend test parent-audio.controller.spec` → пока FAIL (модуль не подключён).

- [ ] **Step 10.3: AudioModule (skeleton)**

Create `apps/backend/src/audio/audio.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { DeviceCommandsModule } from '../device-commands/device-commands.module';
import { AudioService } from './audio.service';
import { AudioEvents } from './audio.events';
import { ParentAudioController } from './parent-audio.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    AppSettingsModule,
    ChildDeviceModule,
    ConsentModule,
    DeviceCommandsModule,
  ],
  controllers: [ParentAudioController],
  providers: [AudioService, AudioEvents],
  exports: [AudioService],
})
export class AudioModule {}
```

И в `app.module.ts` импорт:

```typescript
import { AudioModule } from './audio/audio.module';
// ... в imports[]:
AudioModule,
```

Run integration test → expect PASS.

- [ ] **Step 10.4: Commit**

```bash
git add apps/backend/src/audio/ apps/backend/src/app.module.ts
git commit -m "feat(backend): ParentAudioController + AudioModule wiring"
```

---

### Task 11: ChildAudioController (REST)

**Files:**

- Create: `apps/backend/src/audio/child-audio.controller.ts`
- Create: `apps/backend/src/audio/child-audio.controller.spec.ts`

- [ ] **Step 11.1: Failing integration test**

Create `apps/backend/src/audio/child-audio.controller.spec.ts`:

```typescript
// Аналогично parent-audio.controller.spec.ts, но через X-Child-Token

describe('ChildAudioController (e2e)', () => {
  // ... bootstrap
  let childToken: string;
  let parentJwt: string;
  let sessionId: string;

  beforeEach(async () => {
    // Создать сессию через parent
    const start = await request(app.getHttpServer())
      .post('/api/audio/sessions')
      .set('Authorization', `Bearer ${parentJwt}`)
      .send({ childId, durationSec: 60 });
    sessionId = start.body.id;
  });

  it('POST /child/audio/sessions/:id/ready → 204, transitions to READY', async () => {
    await request(app.getHttpServer())
      .post(`/api/child/audio/sessions/${sessionId}/ready`)
      .set('X-Child-Token', childToken)
      .send({ sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n...' })
      .expect(204);
  });

  it('POST /child/audio/sessions/:id/error → 204, marks FAILED', async () => {
    await request(app.getHttpServer())
      .post(`/api/child/audio/sessions/${sessionId}/error`)
      .set('X-Child-Token', childToken)
      .send({ code: 'PERMISSION_DENIED', message: 'mic denied' })
      .expect(204);

    const session = await prisma.audioSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe('FAILED');
    expect(session?.failureReason).toBe('PERMISSION_DENIED');
  });

  it('POST /child/audio/sessions/:id/ice → 204, persists candidate', async () => {
    await request(app.getHttpServer())
      .post(`/api/child/audio/sessions/${sessionId}/ready`)
      .set('X-Child-Token', childToken)
      .send({ sdp: 'v=0\r\n...' });

    await request(app.getHttpServer())
      .post(`/api/child/audio/sessions/${sessionId}/ice`)
      .set('X-Child-Token', childToken)
      .send({ candidate: 'candidate:1 1 UDP 1234 1.2.3.4 5678 typ host' })
      .expect(204);

    const ice = await prisma.audioIceCandidate.findFirst({ where: { sessionId, side: 'child' } });
    expect(ice).toBeTruthy();
  });

  it('rejects child token from another child', async () => {
    const otherToken = 'd_other_token';
    await request(app.getHttpServer())
      .post(`/api/child/audio/sessions/${sessionId}/ready`)
      .set('X-Child-Token', otherToken)
      .send({ sdp: '...' })
      .expect(403);
  });
});
```

Run: FAIL (controller missing).

- [ ] **Step 11.2: Controller**

Create `apps/backend/src/audio/child-audio.controller.ts`:

```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AudioService } from './audio.service';
import {
  ChildReadySchema,
  IceCandidateSchema,
  ChildErrorSchema,
  type ChildReadyDto,
  type IceCandidateDto,
  type ChildErrorDto,
} from './dto/audio.dto';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child/audio/sessions')
@UseGuards(ChildAuthGuard)
export class ChildAudioController {
  constructor(@Inject(AudioService) private readonly svc: AudioService) {}

  @Post(':id/ready')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async ready(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChildReadySchema)) dto: ChildReadyDto,
  ): Promise<void> {
    await this.svc.childReady({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      sdpOffer: dto.sdp,
    });
  }

  @Post(':id/ice')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 100 } })
  async ice(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IceCandidateSchema)) dto: IceCandidateDto,
  ): Promise<void> {
    await this.svc.childIce({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      candidate: dto.candidate,
    });
  }

  @Post(':id/error')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async error(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChildErrorSchema)) dto: ChildErrorDto,
  ): Promise<void> {
    await this.svc.childError({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      code: dto.code,
      message: dto.message,
    });
  }
}
```

Modify `audio.module.ts` — добавить `ChildAudioController` в `controllers`.

Run integration test → expect PASS.

- [ ] **Step 11.3: Commit**

```bash
git add apps/backend/src/audio/
git commit -m "feat(backend): ChildAudioController (ready/ice/error endpoints)"
```

---

### Task 12: Admin endpoints (settings + sessions list)

**Files:**

- Create: `apps/backend/src/audio/audio-admin.controller.ts`
- Create: `apps/backend/src/audio/audio-admin.controller.spec.ts`

- [ ] **Step 12.1: Failing test**

Create `apps/backend/src/audio/audio-admin.controller.spec.ts`:

```typescript
describe('AudioAdminController (e2e)', () => {
  let adminJwt: string;
  // ... bootstrap

  it('GET /admin/settings/audio → returns 5 keys', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/settings/audio')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    expect(res.body).toMatchObject({
      defaultDurationSec: 300,
      maxDurationSec: 1800,
      minDurationSec: 30,
      hiddenModeAllowed: true,
      childReadyTimeoutSec: 15,
    });
  });

  it('PATCH /admin/settings/audio → updates and returns new values', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/audio')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ defaultDurationSec: 120 })
      .expect(200);
    expect(res.body.defaultDurationSec).toBe(120);
  });

  it('PATCH rejects out-of-range value', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/audio')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ defaultDurationSec: 9999 })
      .expect(400);
  });

  it('GET /admin/audio/sessions → list with pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/audio/sessions?limit=10')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
```

Run: FAIL.

- [ ] **Step 12.2: Controller**

Create `apps/backend/src/audio/audio-admin.controller.ts`:

```typescript
import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard'; // если такого нет — см. patterns в admin.module
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAudioSettingsSchema, type UpdateAudioSettingsDto } from './dto/audio.dto';

interface AdminRequest extends Request {
  user: { userId: string; role: 'admin' };
}

interface AudioSettingsView {
  defaultDurationSec: number;
  maxDurationSec: number;
  minDurationSec: number;
  hiddenModeAllowed: boolean;
  childReadyTimeoutSec: number;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AudioAdminController {
  constructor(
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('settings/audio')
  async getSettings(): Promise<AudioSettingsView> {
    return {
      defaultDurationSec: await this.settings.getNumber(
        SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC,
        300,
      ),
      maxDurationSec: await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, 1800),
      minDurationSec: await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, 30),
      hiddenModeAllowed:
        (await this.settings.getString(SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED, 'true')) === 'true',
      childReadyTimeoutSec: await this.settings.getNumber(
        SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC,
        15,
      ),
    };
  }

  @Patch('settings/audio')
  async updateSettings(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(UpdateAudioSettingsSchema)) dto: UpdateAudioSettingsDto,
  ): Promise<AudioSettingsView> {
    const updates: Array<[string, string]> = [];
    if (dto.defaultDurationSec !== undefined)
      updates.push([SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, String(dto.defaultDurationSec)]);
    if (dto.maxDurationSec !== undefined)
      updates.push([SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, String(dto.maxDurationSec)]);
    if (dto.minDurationSec !== undefined)
      updates.push([SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, String(dto.minDurationSec)]);
    if (dto.hiddenModeAllowed !== undefined)
      updates.push([SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED, String(dto.hiddenModeAllowed)]);
    if (dto.childReadyTimeoutSec !== undefined)
      updates.push([SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC, String(dto.childReadyTimeoutSec)]);

    for (const [k, v] of updates) {
      await this.settings.update(k, v, req.user.userId);
    }
    return this.getSettings();
  }

  // Список сессий для аудита.
  @Get('audio/sessions')
  async listSessions(
    @Query('limit') limit = '50',
    @Query('cursor') cursor?: string,
  ): Promise<{ items: unknown[]; nextCursor?: string }> {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const items = await this.prisma.audioSession.findMany({
      take: take + 1,
      orderBy: { startedAt: 'desc' },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        child: { select: { id: true, name: true, familyId: true } },
        requestedBy: { select: { id: true, email: true } },
      },
    });
    const hasMore = items.length > take;
    return {
      items: items.slice(0, take),
      nextCursor: hasMore ? items[take - 1].id : undefined,
    };
  }
}
```

Modify `audio.module.ts` — добавить `AudioAdminController` в `controllers`. Если нет `AdminGuard` — посмотреть в `apps/backend/src/admin/` или использовать существующий механизм проверки роли (например через decorator `@Roles('admin')`).

Run integration test → PASS.

- [ ] **Step 12.3: Commit**

```bash
git add apps/backend/src/audio/
git commit -m "feat(backend): AudioAdminController (GET/PATCH settings + sessions list)"
```

---

### Task 13: pg_cron retention для audio_sessions / audio_audit_log

**Files:**

- Modify: `infra/docker/postgres/20-retention.sql`

- [ ] **Step 13.1: Добавить retention jobs**

Modify `infra/docker/postgres/20-retention.sql` — добавить в конец:

```sql
-- audio_sessions: 90 дней (метаданные сессий)
SELECT cron.schedule(
  'audio-sessions-retention',
  '17 3 * * *',
  $$DELETE FROM audio_sessions WHERE started_at < NOW() - INTERVAL '90 days'$$
);

-- audio_audit_log: 365 дней (compliance)
SELECT cron.schedule(
  'audio-audit-retention',
  '23 3 * * *',
  $$DELETE FROM audio_audit_log WHERE created_at < NOW() - INTERVAL '365 days'$$
);
```

> ⚠ Этот файл выполняется только при первом инициализации БД (entrypoint Postgres). Для существующего dev-стэка надо вручную выполнить добавленные строки через `docker exec gmd-postgres-dev psql -U gmd -d gmd_dev -f /docker-entrypoint-initdb.d/20-retention.sql` ИЛИ выполнить только новые строки.

- [ ] **Step 13.2: Применить вручную в dev**

Run:

```bash
docker exec -i gmd-postgres-dev psql -U gmd -d gmd_dev <<'SQL'
SELECT cron.schedule('audio-sessions-retention', '17 3 * * *',
  $$DELETE FROM audio_sessions WHERE started_at < NOW() - INTERVAL '90 days'$$);
SELECT cron.schedule('audio-audit-retention', '23 3 * * *',
  $$DELETE FROM audio_audit_log WHERE created_at < NOW() - INTERVAL '365 days'$$);
SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'audio-%';
SQL
```

Expected: вывод показывает обе job'ы.

- [ ] **Step 13.3: Commit**

```bash
git add infra/docker/postgres/20-retention.sql
git commit -m "feat(infra): pg_cron retention для audio_sessions (90д) и audit (365д)"
```

---

### Task 14: Документация в OpenAPI / docs/api

**Files:**

- Modify: `docs/api.md` (если есть, иначе посмотреть `apps/backend/src/main.ts` — там OpenAPI auto-gen?)
- Create: `docs/audio-api.md` (если отдельно описываем)

- [ ] **Step 14.1: Описать API**

Если есть авто-OpenAPI — Task 14 сводится к проверке, что endpoints видны в `/api/docs` (Swagger UI), и добавлению `@ApiTags`/`@ApiOperation` к контроллерам.

Если автогена нет — создать `docs/audio-api.md` с описанием endpoints (см. spec §6 как референс).

- [ ] **Step 14.2: Commit**

```bash
git add docs/
git commit -m "docs: API «Звук вокруг ребёнка» (parent + child + admin endpoints)"
```

---

### Task 15: Версия + CHANGELOG

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `package.json` (root) + sync через `pnpm version:sync`

- [ ] **Step 15.1: Bump версии**

Run:

```bash
npm version 0.32.0 --no-git-tag-version --workspaces=false
pnpm version:sync
pnpm version:check
```

Expected: все package.json и pubspec.yaml обновились до 0.32.0, check проходит.

- [ ] **Step 15.2: CHANGELOG**

Modify `CHANGELOG.md` — добавить сверху блок:

```markdown
## v0.32.0 — 2026-04-23

### Новые возможности

- **«Звук вокруг ребёнка» — backend и infra** — добавлен TURN-сервер coturn в docker-compose (dev + prod), Prisma-схема `audio_sessions` + `audio_audit_log`, REST API для родителя и ребёнка (POST `/audio/sessions`, `/answer`, `/ice`, `/stop`, SSE `/events`; child-side `/ready`, `/ice`, `/error`), HMAC-SHA1 TURN-credentials генератор (RFC 5766), state-machine `PENDING→READY→ACTIVE→ENDED|FAILED|EXPIRED`, hidden-mode (без push/баннера ребёнку, system privacy indicator Android всё равно появится), 5 минут default + админ-настройка `audio.*`, retention 90д для сессий и 365д для audit. Mobile-клиенты ещё не реализованы — ждут Plans B/C.

### Изменения

- chore: новый модуль `apps/backend/src/audio/`, Prisma migration `audio_sessions`, расширен `DeviceCommandType` (`+START_AUDIO`, `+STOP_AUDIO`)
```

- [ ] **Step 15.3: Commit + tag**

```bash
git add -A
git commit -m "chore: release v0.32.0 — «Звук вокруг» backend (Plan A)"
git tag v0.32.0
```

---

## Self-Review Checklist (для имплементатора перед PR)

- [ ] Все unit-тесты проходят (`pnpm --filter @gmd/backend test`)
- [ ] Integration-тесты (parent + child + admin) проходят
- [ ] `pnpm --filter @gmd/backend typecheck` зелёный
- [ ] `pnpm --filter @gmd/backend lint` зелёный
- [ ] Запуск `pnpm stack:up` поднимает coturn без ошибок
- [ ] curl `POST /api/audio/sessions` возвращает 201 + turnCreds (ручная проверка)
- [ ] `docker exec gmd-coturn-dev turnutils_uclient -u <username> -w <password> 127.0.0.1` подключается успешно с реальными кредами от endpoint'а
- [ ] CHANGELOG обновлён, версия = 0.32.0, `pnpm version:check` проходит
- [ ] Декомпозиция: ни один файл audio/ не превысил 350 строк
- [ ] Никаких хардкоженных секретов / TURN-паролей в коде

## Open Questions (для пользователя перед стартом)

1. **AdminGuard:** существует ли уже декоратор/guard для проверки роли `admin`? Если нет — нужна Task 12.5 для его создания (или использовать паттерн из существующих admin-endpoints). Проверить через `Grep "AdminGuard|@Roles\(.admin"` перед началом.
2. **OpenAPI:** автогенерация уже включена? Если да — Task 14 = просто `@ApiTags` декораторы; если нет — отдельная задача.
3. **`network_mode: host` для coturn в Windows-dev:** на Windows/Mac не работает «как на Linux». Если активный dev — на Windows, нужен альтернативный конфиг с `min-port`/`max-port` + явные port mappings (узкий range, например 49152-49200). Дополнительная Task 1.5 при необходимости.

---

**Plan summary:** 15 tasks, ~90 шагов, оценка 3-5 рабочих дней (опытный backend-developer + знание NestJS/Prisma).
