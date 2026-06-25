# API «Звук вокруг ребёнка» — документация Перископа

**Версия:** 1.0 (2026-04-23)
**Статус:** Draft — актуально для Phase 5.2 (backend signaling)
**Связанные документы:**

- Дизайн: `docs/superpowers/specs/2026-04-23-gmd-sound-around-design.md`
- Plan-A infra+backend: `docs/superpowers/plans/2026-04-23-gmd-sound-around-plan-A-infra-backend.md`
- DTO: `apps/backend/src/audio/dto/audio.dto.ts`

---

## 1. Обзор фичи

«Звук вокруг ребёнка» позволяет родителю по запросу прослушать звук окружения с устройства ребёнка в режиме, близком к реальному времени (целевая задержка ≤ 1 сек). Фича предназначена для кризисных ситуаций: ребёнок не отвечает на звонок, проверка «дошёл ли до школы», подозрение на буллинг.

Технически реализовано через **WebRTC peer-to-peer** соединение (child → parent), где backend выступает только в роли **signaling-сервера**: передаёт SDP offer/answer и ICE-кандидаты между сторонами. Аудио проходит напрямую через TURN-сервер (coturn) и **не хранится** на серверах GMD — только метаданные сессии.

---

## 2. Архитектура signaling

### 2.1 Компоненты

```
┌──────────────────────┐                       ┌─────────────────────┐
│  web-parent          │ ◀── WebRTC audio ───▶  │  mobile-child       │
│  (Next.js/WebRTC)    │     (через TURN)        │  (FGS microphone)   │
│                      │                        │                     │
│  mobile-parent       │                        │  Android only       │
│  (flutter_webrtc)    │                        │                     │
└──────────┬───────────┘                        └──────────┬──────────┘
           │                                               │
           │  REST + SSE (signaling)                       │  REST + FCM push
           │                                               │
           └───────────────────┬───────────────────────────┘
                               ▼
                     ┌──────────────────────┐
                     │  backend (NestJS)    │
                     │  /api/audio/...      │
                     │  /api/child/audio/.. │
                     │  /api/admin/...      │
                     └──────────┬───────────┘
                                │
                    ┌───────────┴────────────┐
                    │                        │
             ┌──────▼──────┐        ┌───────▼──────┐
             │  PostgreSQL  │        │   coturn     │
             │  audio_sess. │        │   (TURN)     │
             │  audit_log   │        │   UDP 3478   │
             └─────────────┘        │   TLS 5349   │
                                    └──────────────┘
```

### 2.2 Последовательность signaling

```
parent              backend           FCM push          child            TURN
  │                    │                  │              │                │
  ├─POST /audio/sessions──────────────────▶              │                │
  │  {childId, ...}    │                  │              │                │
  │                    ├─create session   │              │                │
  │                    │  state=PENDING   │              │                │
  │◀─201 {id, TURN}────┤                  │              │                │
  │                    ├─push "audio.start"──────────────▶                │
  │                    │                  │              │                │
  ├─GET /audio/sessions/{id}/events (SSE открыто)        │                │
  │                    │                  │              │                │
  │                    │                  │              ├─FGS start──────▶ (allocate relay)
  │                    │                  │              ├─POST /child/audio/sessions/{id}/ready
  │                    │                  │              │  {sdp: offer}  │
  │                    ├─state→READY      │              │                │
  │◀─SSE: {state:READY, payload:{sdp}}────┤              │                │
  │                    │                  │              │                │
  ├─POST /audio/sessions/{id}/answer──────▶              │                │
  │  {sdp: answer}     │                  │              │                │
  │                    ├─push answer SDP──────────────────▶               │
  │                    │                  │              │                │
  ├─POST /audio/sessions/{id}/ice─────────▶ (trickle)    │                │
  │                    │                  │              │                │
  │                    │                  │   push ICE──▶│                │
  │                    │                  │              │                │
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║       WebRTC audio потоки через TURN (DTLS-SRTP зашифровано)         ║
  ╚═══════════════════════════════════════════════════════════════════════╝
  │                    │                  │              │                │
  ├─POST /audio/sessions/{id}/stop────────▶              │                │
  │                    ├─push "audio.stop"───────────────▶                │
  │                    │                  │              ├─FGS stop───────┘
  │                    ├─state→ENDED      │              │
  │◀─SSE: {state:ENDED}┤                  │              │
```

### 2.3 Принципы

- **Backend не транслирует аудио.** Он только пересылает SDP/ICE-кандидаты между сторонами. Реальный медиапоток идёт напрямую через TURN.
- **TURN обязателен на MVP.** Мобильные устройства за CGNAT/симметричным NAT не пробьют STUN. Для Перископа-ребёнка включён force-relay режим (не светит IP родителя).
- **SSE только для parent.** Child получает сигналы через FCM push (answer SDP, ICE-кандидаты, команда stop).

---

## 3. Аутентификация

### 3.1 Parent (JWT Bearer)

Все parent-endpoints требуют:

1. Валидный JWT (access token, TTL 15 мин) в заголовке `Authorization: Bearer <token>`.
2. Пройденный `ConsentRequiredGuard` — родитель должен принять актуальную версию согласия на аудиомониторинг.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Токен получается через `POST /api/auth/login` или обновляется через `POST /api/auth/refresh`.

### 3.2 Child (X-Child-Token)

Child-endpoints требуют long-lived device-token (не истекает, выдаётся при claim-invite):

```
X-Child-Token: <device_token>
```

Токен проверяется `ChildAuthGuard`. Из него извлекается `deviceId` и `childId`.

### 3.3 Admin (JWT + AdminGuard)

Admin-endpoints требуют JWT родителя с флагом `isAdmin = true` в БД:

```
Authorization: Bearer <admin_jwt>
```

---

## 4. Endpoints

### 4.1 Parent endpoints

Базовый путь: `/api/audio/sessions`
Guards: `JwtAuthGuard`, `ConsentRequiredGuard`

| Метод  | Путь                             | Описание                | Throttle |
| ------ | -------------------------------- | ----------------------- | -------- |
| `POST` | `/api/audio/sessions`            | Создать сессию          | 6/мин    |
| `POST` | `/api/audio/sessions/:id/answer` | SDP answer от parent    | 30/мин   |
| `POST` | `/api/audio/sessions/:id/ice`    | ICE candidate от parent | 100/мин  |
| `POST` | `/api/audio/sessions/:id/stop`   | Завершить сессию        | 10/мин   |
| `GET`  | `/api/audio/sessions/:id/events` | SSE-стрим событий       | —        |

---

#### `POST /api/audio/sessions` — создать сессию

**Request body** (`CreateAudioSessionDto`):

```json
{
  "childId": "uuid-ребёнка",
  "durationSec": 300,
  "hiddenMode": true
}
```

| Поле          | Тип               | Обязательно | Описание                                                                                   |
| ------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `childId`     | string (UUID)     | да          | ID ребёнка (должен быть в family родителя)                                                 |
| `durationSec` | integer (30–1800) | нет         | Длительность сессии в секундах. По умолчанию: `defaultDurationSec` из admin-настроек (300) |
| `hiddenMode`  | boolean           | нет         | Не уведомлять ребёнка в приложении. По умолчанию: `true`                                   |

**Response 201** (`CreateAudioSessionResponse`):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "state": "PENDING",
  "expiresAt": "2026-04-23T10:45:00.000Z",
  "turnCreds": {
    "url": "turn:turn.gmd-online.ru:3478",
    "username": "1745401500:550e8400-e29b-41d4-a716-446655440000",
    "password": "BASE64_HMAC_SHA1_STRING==",
    "ttl": 360
  }
}
```

**Ошибки:**

| HTTP | Код                   | Причина                                                           |
| ---- | --------------------- | ----------------------------------------------------------------- |
| 400  | VALIDATION_ERROR      | Невалидный body (Zod)                                             |
| 403  | FORBIDDEN             | Ребёнок не принадлежит family родителя                            |
| 403  | CONSENT_REQUIRED      | Родитель не принял согласие на аудиомониторинг                    |
| 409  | ACTIVE_SESSION_EXISTS | Для этого ребёнка уже есть активная сессия (PENDING/READY/ACTIVE) |
| 429  | TOO_MANY_REQUESTS     | Превышен throttle (6 запусков/мин)                                |

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/audio/sessions \
  -H "Authorization: Bearer <parent_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"childId":"550e8400-e29b-41d4-a716-446655440000","durationSec":300,"hiddenMode":true}'
```

---

#### `POST /api/audio/sessions/:id/answer` — SDP answer

Вызывается после получения SSE-события `{state: "READY", payload: {sdp: "..."}}`. Parent отправляет SDP answer, который backend перенаправляет child через push.

**Request body** (`ParentAnswerDto`):

```json
{
  "sdp": "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n..."
}
```

| Поле  | Тип    | Ограничения                |
| ----- | ------ | -------------------------- |
| `sdp` | string | min 1, max 10 000 символов |

**Response: 204 No Content**

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/audio/sessions/550e8400-e29b-41d4-a716-446655440000/answer \
  -H "Authorization: Bearer <parent_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"sdp":"v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n..."}'
```

---

#### `POST /api/audio/sessions/:id/ice` — ICE candidate от parent

Вызывается в процессе ICE-трикл. WebRTC может генерировать 5–15 кандидатов за несколько секунд. Throttle 100/мин.

**Request body** (`IceCandidateDto`):

```json
{
  "candidate": "candidate:0 1 UDP 2122252543 192.168.1.5 52384 typ host"
}
```

| Поле        | Тип    | Ограничения               |
| ----------- | ------ | ------------------------- |
| `candidate` | string | min 1, max 2 000 символов |

**Response: 204 No Content**

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/audio/sessions/550e8400-.../ice \
  -H "Authorization: Bearer <parent_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"candidate":"candidate:0 1 UDP 2122252543 192.168.1.5 52384 typ host"}'
```

---

#### `POST /api/audio/sessions/:id/stop` — завершить сессию

Штатное завершение родителем (нажал «Стоп»). Backend переводит сессию в `ENDED`, отправляет push child для остановки FGS.

**Request body:** пустое тело

**Response: 204 No Content**

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/audio/sessions/550e8400-.../stop \
  -H "Authorization: Bearer <parent_jwt>"
```

---

#### `GET /api/audio/sessions/:id/events` — SSE-стрим

Родитель открывает SSE-соединение сразу после создания сессии и держит его до `ENDED`/`FAILED`/`EXPIRED`.

**Заголовки запроса:**

```
Authorization: Bearer <parent_jwt>
Accept: text/event-stream
```

**curl-пример:**

```bash
curl -N http://localhost:3001/api/audio/sessions/550e8400-.../events \
  -H "Authorization: Bearer <parent_jwt>" \
  -H "Accept: text/event-stream"
```

**Формат событий:**

```
data: {"state":"PENDING","payload":null}

data: {"state":"READY","payload":{"sdp":"v=0\r\no=- ..."}}

data: {"state":"ACTIVE","payload":null}

data: {"state":"ENDED","payload":{"actualSec":287}}

data: {"state":"ICE_FROM_CHILD","payload":{"candidate":"candidate:..."}}

data: {"state":"FAILED","payload":{"reason":"PERMISSION_DENIED"}}

data: {"state":"EXPIRED","payload":null}
```

Полное описание типов событий — в разделе 7.

---

### 4.2 Child endpoints

Базовый путь: `/api/child/audio/sessions`
Guard: `ChildAuthGuard`
Header: `X-Child-Token: <device_token>`

| Метод  | Путь                                  | Описание                    | Throttle |
| ------ | ------------------------------------- | --------------------------- | -------- |
| `POST` | `/api/child/audio/sessions/:id/ready` | Child готов, шлёт SDP offer | 10/мин   |
| `POST` | `/api/child/audio/sessions/:id/ice`   | ICE candidate от child      | 100/мин  |
| `POST` | `/api/child/audio/sessions/:id/error` | Сообщить об ошибке          | 10/мин   |

---

#### `POST /api/child/audio/sessions/:id/ready` — child готов с SDP offer

Вызывается когда child поднял FGS, захватил микрофон и сформировал SDP offer. Переводит сессию `PENDING → READY`.

**Request body** (`ChildReadyDto`):

```json
{
  "sdp": "v=0\r\no=- 8837171117989672316 2 IN IP4 127.0.0.1\r\n..."
}
```

| Поле  | Тип    | Ограничения                |
| ----- | ------ | -------------------------- |
| `sdp` | string | min 1, max 10 000 символов |

**Response: 204 No Content**

После этого parent получает SSE-событие `{state:"READY", payload:{sdp:...}}`.

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/child/audio/sessions/550e8400-.../ready \
  -H "X-Child-Token: <device_token>" \
  -H "Content-Type: application/json" \
  -d '{"sdp":"v=0\r\no=- 8837171117989672316 2 IN IP4 127.0.0.1\r\n..."}'
```

---

#### `POST /api/child/audio/sessions/:id/ice` — ICE candidate от child

Тот же механизм, что и у parent. Backend пересылает кандидата через SSE в parent.

**Request body** (`IceCandidateDto`):

```json
{
  "candidate": "candidate:3 1 UDP 33562623 45.67.230.87 51230 typ relay raddr 0.0.0.0 rport 0"
}
```

**Response: 204 No Content**

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/child/audio/sessions/550e8400-.../ice \
  -H "X-Child-Token: <device_token>" \
  -H "Content-Type: application/json" \
  -d '{"candidate":"candidate:3 1 UDP 33562623 45.67.230.87 51230 typ relay..."}'
```

---

#### `POST /api/child/audio/sessions/:id/error` — ошибка

Вызывается если child не может выполнить запрос. Переводит сессию в `FAILED`. Родитель получает SSE `{state:"FAILED", payload:{reason:"..."}}`.

**Request body** (`ChildErrorDto`):

```json
{
  "code": "PERMISSION_DENIED",
  "message": "RECORD_AUDIO permission not granted by user"
}
```

| Поле      | Тип              | Допустимые значения                                                        |
| --------- | ---------------- | -------------------------------------------------------------------------- |
| `code`    | enum             | `PERMISSION_DENIED`, `MIC_BUSY`, `OEM_BLOCKED`, `NETWORK_ERROR`, `UNKNOWN` |
| `message` | string (max 500) | нет — опционально, для диагностики                                         |

**Response: 204 No Content**

**curl-пример:**

```bash
curl -X POST http://localhost:3001/api/child/audio/sessions/550e8400-.../error \
  -H "X-Child-Token: <device_token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"MIC_BUSY","message":"AudioRecord failed: in use by another app"}'
```

---

### 4.3 Admin endpoints

Базовый путь: `/api/admin`
Guards: `JwtAuthGuard`, `AdminGuard`

| Метод   | Путь                        | Описание              |
| ------- | --------------------------- | --------------------- |
| `GET`   | `/api/admin/settings/audio` | Текущие настройки     |
| `PATCH` | `/api/admin/settings/audio` | Обновить настройки    |
| `GET`   | `/api/admin/audio/sessions` | Список сессий (аудит) |

---

#### `GET /api/admin/settings/audio` — текущие настройки

**Response 200:**

```json
{
  "defaultDurationSec": 300,
  "maxDurationSec": 1800,
  "minDurationSec": 30,
  "hiddenModeAllowed": true,
  "childReadyTimeoutSec": 45
}
```

**curl-пример:**

```bash
curl http://localhost:3001/api/admin/settings/audio \
  -H "Authorization: Bearer <admin_jwt>"
```

---

#### `PATCH /api/admin/settings/audio` — обновить настройки

**Request body** (`UpdateAudioSettingsDto`) — все поля опциональные:

```json
{
  "defaultDurationSec": 180,
  "maxDurationSec": 600,
  "minDurationSec": 30,
  "hiddenModeAllowed": true,
  "childReadyTimeoutSec": 45
}
```

| Поле                   | Тип     | Диапазон | Описание                                      |
| ---------------------- | ------- | -------- | --------------------------------------------- |
| `defaultDurationSec`   | integer | 30–1800  | Длительность по умолчанию                     |
| `maxDurationSec`       | integer | 60–3600  | Максимально допустимая длительность           |
| `minDurationSec`       | integer | 10–600   | Минимально допустимая длительность            |
| `hiddenModeAllowed`    | boolean | —        | Разрешить hidden mode (без уведомления child) |
| `childReadyTimeoutSec` | integer | 5–120    | Таймаут ожидания `ready` от child до EXPIRED  |

**Response 200:** обновлённые настройки (тот же формат что GET)

**curl-пример:**

```bash
curl -X PATCH http://localhost:3001/api/admin/settings/audio \
  -H "Authorization: Bearer <admin_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"defaultDurationSec":180,"childReadyTimeoutSec":60}'
```

---

#### `GET /api/admin/audio/sessions` — список сессий (аудит)

Cursor-pagination по убыванию `startedAt`. По умолчанию `limit=50`, максимум 200.

**Query params:**

| Param    | Тип             | Описание                                   |
| -------- | --------------- | ------------------------------------------ |
| `limit`  | integer (1–200) | Количество записей. По умолчанию: 50       |
| `cursor` | string (UUID)   | ID последней записи из предыдущей страницы |

**Response 200:**

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "childId": "child-uuid",
      "childName": "Маша",
      "familyId": "family-uuid",
      "requestedById": "parent-uuid",
      "requestedByEmail": "parent@example.com",
      "state": "ENDED",
      "hiddenMode": true,
      "durationSec": 300,
      "actualSec": 287,
      "failureReason": null,
      "startedAt": "2026-04-23T10:00:00.000Z",
      "endedAt": "2026-04-23T10:04:47.000Z"
    }
  ],
  "nextCursor": "another-uuid-for-next-page"
}
```

Если `nextCursor` отсутствует в ответе — это последняя страница.

**curl-пример:**

```bash
# Первая страница
curl "http://localhost:3001/api/admin/audio/sessions?limit=50" \
  -H "Authorization: Bearer <admin_jwt>"

# Следующая страница
curl "http://localhost:3001/api/admin/audio/sessions?limit=50&cursor=550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <admin_jwt>"
```

---

## 5. State-machine сессии

### 5.1 Диаграмма

```mermaid
stateDiagram-v2
    [*] --> PENDING : POST /audio/sessions (parent)
    PENDING --> READY : POST /child/audio/sessions/:id/ready (child)
    PENDING --> FAILED : POST /child/audio/sessions/:id/error (child)
    PENDING --> EXPIRED : watchdog: childReadyTimeoutSec истёк

    READY --> ACTIVE : parent прислал answer + ICE-обмен завершён
    READY --> FAILED : POST /child/audio/sessions/:id/error (child)
    READY --> EXPIRED : watchdog: READY > 5 мин без ответа parent

    ACTIVE --> ENDED : POST /audio/sessions/:id/stop (parent)
    ACTIVE --> ENDED : watchdog: durationSec истёк (auto-END)
    ACTIVE --> FAILED : потеря соединения / внешняя ошибка

    ENDED --> [*]
    FAILED --> [*]
    EXPIRED --> [*]
```

### 5.2 Описание состояний

| Состояние | Описание                                                                        | Следующие               |
| --------- | ------------------------------------------------------------------------------- | ----------------------- |
| `PENDING` | Сессия создана. Push отправлен child. Ожидание SDP offer от child.              | READY, FAILED, EXPIRED  |
| `READY`   | Child прислал SDP offer. Ожидание SDP answer от parent.                         | ACTIVE, FAILED, EXPIRED |
| `ACTIVE`  | ICE-обмен завершён, аудио идёт.                                                 | ENDED, FAILED           |
| `ENDED`   | Штатное завершение (parent нажал «Стоп» или истёк `durationSec`).               | —                       |
| `FAILED`  | Ошибка child-стороны (PERMISSION_DENIED, MIC_BUSY, OEM_BLOCKED, NETWORK_ERROR). | —                       |
| `EXPIRED` | Child не ответил за `childReadyTimeoutSec` (default 45 сек).                    | —                       |

### 5.3 Race condition защита

В БД действует `UNIQUE partial index`:

```sql
CREATE UNIQUE INDEX audio_sessions_active_child_idx
  ON audio_sessions (child_id)
  WHERE state IN ('PENDING', 'READY', 'ACTIVE');
```

Попытка создать вторую активную сессию для того же ребёнка вернёт Prisma-ошибку `P2002` (unique constraint violation) → backend возвращает `409 Conflict`.

---

## 6. Error codes

### 6.1 HTTP ошибки

| HTTP | Ситуация                                           |
| ---- | -------------------------------------------------- |
| 400  | Zod validation error (невалидный body)             |
| 401  | Отсутствует или просрочен JWT / X-Child-Token      |
| 403  | Нет доступа к ребёнку / не принято согласие        |
| 409  | Уже есть активная сессия для данного child         |
| 422  | Бизнес-ошибка (попытка answer для не-READY сессии) |
| 429  | Rate limit exceeded                                |
| 500  | Внутренняя ошибка сервера                          |

**Формат ответа при ошибке:**

```json
{
  "statusCode": 409,
  "message": "ACTIVE_SESSION_EXISTS",
  "error": "Conflict"
}
```

### 6.2 Child error codes

Коды ошибок, которые child сообщает через `POST /child/audio/sessions/:id/error`:

| Код                 | Причина                                                 | Что видит родитель                                                                      |
| ------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PERMISSION_DENIED` | `RECORD_AUDIO` запрещён пользователем или не запрошен   | «Микрофон недоступен. Проверьте разрешения в настройках устройства ребёнка»             |
| `MIC_BUSY`          | Микрофон занят другим приложением (звонок, диктофон)    | «Микрофон занят. Попробуйте позже»                                                      |
| `OEM_BLOCKED`       | OEM (Xiaomi/HyperOS, Honor) убил FGS до поднятия WebRTC | «Приложение на устройстве ребёнка заблокировано системой. Настройте разрешение батареи» |
| `NETWORK_ERROR`     | Не удалось подключиться к TURN или backend              | «Проблема с сетью. Попробуйте позже»                                                    |
| `UNKNOWN`           | Неизвестная ошибка                                      | «Технический сбой»                                                                      |

### 6.3 Zod validation errors

При невалидном body backend возвращает 400 с описанием поля:

```json
{
  "statusCode": 400,
  "message": ["childId: Required", "durationSec: Number must be between 30 and 1800"],
  "error": "Bad Request"
}
```

---

## 7. SSE-события

### 7.1 Подключение

Parent открывает SSE-соединение:

```
GET /api/audio/sessions/:id/events
Accept: text/event-stream
Authorization: Bearer <jwt>
```

Соединение остаётся открытым. Каждое событие — одна строка `data: <json>\n\n`.

### 7.2 Типы событий

| `state`          | `payload`             | Когда                                                                                                 |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `PENDING`        | `null`                | Подтверждение создания (опционально, может не приходить)                                              |
| `READY`          | `{sdp: string}`       | Child прислал SDP offer — **parent должен немедленно создать `RTCPeerConnection` и отправить answer** |
| `ACTIVE`         | `null`                | ICE-обмен завершён, аудио в эфире                                                                     |
| `ICE_FROM_CHILD` | `{candidate: string}` | ICE-кандидат от child — **parent добавляет через `addIceCandidate`**                                  |
| `ENDED`          | `{actualSec: number}` | Штатное завершение                                                                                    |
| `FAILED`         | `{reason: string}`    | Ошибка (reason = один из child error codes)                                                           |
| `EXPIRED`        | `null`                | Таймаут ожидания child                                                                                |

### 7.3 Пример SSE-потока (happy path)

```
data: {"state":"PENDING","payload":null}

data: {"state":"READY","payload":{"sdp":"v=0\r\no=- 883717 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111..."}}

data: {"state":"ICE_FROM_CHILD","payload":{"candidate":"candidate:3 1 UDP 33562623 45.67.230.87 51230 typ relay raddr 0.0.0.0 rport 0"}}

data: {"state":"ACTIVE","payload":null}

data: {"state":"ENDED","payload":{"actualSec":287}}
```

### 7.4 Обработка разрыва SSE

Если SSE-соединение обрывается (мобильный браузер переходит в background), клиент должен переподключиться. При переподключении backend сразу отправляет текущее состояние сессии. Если сессия уже в терминальном состоянии (`ENDED`/`FAILED`/`EXPIRED`) — SSE немедленно закрывается.

---

## 8. Throttle лимиты

| Endpoint                                     | Лимит | Окно   | Причина                                |
| -------------------------------------------- | ----- | ------ | -------------------------------------- |
| `POST /audio/sessions`                       | 6     | 60 сек | Защита от случайных петель и abuse     |
| `POST /audio/sessions/:id/answer`            | 30    | 60 сек | Повторные ответы при переподключении   |
| `POST /audio/sessions/:id/ice` (parent)      | 100   | 60 сек | ICE trickling: 5–15 кандидатов × запас |
| `POST /audio/sessions/:id/stop`              | 10    | 60 сек | Защита от flood                        |
| `POST /child/audio/sessions/:id/ready`       | 10    | 60 сек | Ретри при network error                |
| `POST /child/audio/sessions/:id/ice` (child) | 100   | 60 сек | ICE trickling                          |
| `POST /child/audio/sessions/:id/error`       | 10    | 60 сек | Один-два отчёта об ошибке              |

При превышении: HTTP 429 `Too Many Requests`.

---

## 9. Примеры flows

### 9.1 Happy path (полный цикл)

**Шаг 1: Parent создаёт сессию**

```bash
POST /api/audio/sessions
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "childId": "child-uuid-123",
  "durationSec": 300,
  "hiddenMode": true
}
```

Ответ `201`:

```json
{
  "id": "session-uuid-456",
  "state": "PENDING",
  "expiresAt": "2026-04-23T10:45:00.000Z",
  "turnCreds": {
    "url": "turn:turn.gmd-online.ru:3478",
    "username": "1745401500:session-uuid-456",
    "password": "Xb3K+q8/mNpZ...",
    "ttl": 360
  }
}
```

**Шаг 2: Parent открывает SSE и инициализирует RTCPeerConnection**

```javascript
// Web-parent (JavaScript)
const pc = new RTCPeerConnection({
  iceServers: [
    {
      urls: 'turn:turn.gmd-online.ru:3478',
      username: '1745401500:session-uuid-456',
      credential: 'Xb3K+q8/mNpZ...',
    },
  ],
});

const sse = new EventSource('/api/audio/sessions/session-uuid-456/events');
sse.onmessage = (e) => handleSseEvent(JSON.parse(e.data));
```

**Шаг 3: Child получает FCM push, стартует FGS**

Payload FCM push:

```json
{
  "type": "audio.start",
  "sessionId": "session-uuid-456",
  "durationSec": 300
}
```

**Шаг 4: Child отправляет SDP offer**

```bash
POST /api/child/audio/sessions/session-uuid-456/ready
X-Child-Token: device_token_xyz
Content-Type: application/json

{
  "sdp": "v=0\r\no=- 8837171117989672316 2 IN IP4 127.0.0.1\r\n..."
}
```

**Шаг 5: Parent получает SSE READY и отправляет answer**

```javascript
// Из SSE: {state: "READY", payload: {sdp: "..."}}
await pc.setRemoteDescription({ type: 'offer', sdp: event.payload.sdp });
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);

// Отправить answer:
await fetch('/api/audio/sessions/session-uuid-456/answer', {
  method: 'POST',
  headers: { Authorization: 'Bearer ...', 'Content-Type': 'application/json' },
  body: JSON.stringify({ sdp: answer.sdp }),
});
```

**Шаг 6: ICE trickling**

```javascript
// Parent отправляет свои ICE-кандидаты
pc.onicecandidate = (e) => {
  if (e.candidate) {
    fetch('/api/audio/sessions/session-uuid-456/ice', {
      method: 'POST',
      body: JSON.stringify({ candidate: e.candidate.candidate }),
    });
  }
};

// Из SSE добавляем кандидаты от child:
// {state: "ICE_FROM_CHILD", payload: {candidate: "..."}}
await pc.addIceCandidate({ candidate: event.payload.candidate });
```

**Шаг 7: Аудио активно**

SSE: `{"state":"ACTIVE","payload":null}` — подключить `<audio>` элемент к `pc.ontrack`.

**Шаг 8: Завершение**

```bash
POST /api/audio/sessions/session-uuid-456/stop
Authorization: Bearer eyJ...
```

SSE: `{"state":"ENDED","payload":{"actualSec":287}}`

---

### 9.2 Edge case: ребёнок offline (EXPIRED)

1. Parent создаёт сессию → `PENDING`
2. FCM push не доставлен (ребёнок без интернета / app force-stopped)
3. Через `childReadyTimeoutSec` (45 сек) watchdog (pg_cron) переводит в `EXPIRED`
4. Parent получает SSE: `{"state":"EXPIRED","payload":null}`
5. UI показывает: «Ребёнок не отвечает. Устройство, вероятно, офлайн»

---

### 9.3 Edge case: микрофон занят (MIC_BUSY)

1. Parent создаёт сессию → `PENDING`
2. Child получает push, стартует FGS, пытается захватить микрофон
3. `AudioRecord` возвращает ошибку (звонок активен)
4. Child отправляет:
   ```bash
   POST /api/child/audio/sessions/session-uuid-456/error
   {"code":"MIC_BUSY","message":"AudioRecord failed: in_use"}
   ```
5. Backend → `FAILED`
6. SSE: `{"state":"FAILED","payload":{"reason":"MIC_BUSY"}}`
7. UI: «Микрофон занят. Завершите звонок и попробуйте снова»

---

### 9.4 Edge case: OEM убил FGS (EXPIRED с задержкой)

1. Child получает push, FGS стартует
2. Xiaomi HyperOS kill FGS до того как WebRTC успел поднять peer connection
3. Child не успевает отправить error (процесс убит)
4. Через `childReadyTimeoutSec` → `EXPIRED`
5. UI рекомендует: «Настройте разрешения батареи для GMD на устройстве ребёнка»

---

### 9.5 Edge case: попытка двойной сессии (409)

```bash
POST /api/audio/sessions
{"childId": "child-uuid-123", "durationSec": 300}

# Ответ:
HTTP 409 Conflict
{
  "statusCode": 409,
  "message": "ACTIVE_SESSION_EXISTS"
}
```

Unique partial index в БД блокирует создание второй PENDING/READY/ACTIVE сессии для того же child_id.

---

## 10. TURN-credentials (RFC 5766 HMAC)

### 10.1 Формат credentials

```
username = "<unix_timestamp_expiry>:<sessionId>"
password = base64(HMAC_SHA1(TURN_SECRET, username))
```

Пример:

```
username = "1745401500:550e8400-e29b-41d4-a716-446655440000"
password = "Xb3K+q8/mNpZ9aT2vH=="
ttl = childReadyTimeoutSec + durationSec + 60
   = 45 + 300 + 60 = 405 секунд
```

- `unix_timestamp_expiry` = текущее время + TTL. TURN-сервер проверяет, что timestamp не истёк.
- `TURN_SECRET` — shared secret между backend и TURN-сервером (env var `COTURN_SECRET`).
- TTL рассчитывается с запасом: `childReadyTimeoutSec + durationSec + 60` — чтобы credentials не протухли пока сессия ещё активна.

### 10.2 Использование в RTCPeerConnection

**JavaScript (web-parent):**

```javascript
const { turnCreds } = createSessionResponse;

const pc = new RTCPeerConnection({
  iceServers: [
    {
      urls: turnCreds.url, // "turn:turn.gmd-online.ru:3478"
      username: turnCreds.username, // "1745401500:session-uuid"
      credential: turnCreds.password, // "BASE64_HMAC=="
    },
    // Опционально TLS для корпоративных сетей:
    {
      urls: 'turns:turn.gmd-online.ru:5349',
      username: turnCreds.username,
      credential: turnCreds.password,
    },
  ],
  // Force relay — не светим IP родителя:
  iceTransportPolicy: 'relay',
});
```

**Dart/Flutter (mobile-parent, flutter_webrtc):**

```dart
final config = {
  'iceServers': [
    {
      'urls': [turnCreds.url],
      'username': turnCreds.username,
      'credential': turnCreds.password,
    }
  ],
  'iceTransportPolicy': 'relay', // force TURN
};

final pc = await createPeerConnection(config);
```

**Dart/Flutter (mobile-child, SoundAroundService):**

Child тоже использует те же credentials. Получает их из FCM push payload:

```dart
// FCM push payload:
// {
//   "type": "audio.start",
//   "sessionId": "...",
//   "durationSec": 300,
//   "turn": {
//     "url": "turn:...",
//     "username": "...",
//     "credential": "..."
//   }
// }
```

### 10.3 Почему force-relay для child

В coturn настроен `relay-only` для child-соединений: child всегда подключается через TURN relay, не напрямую. Это гарантирует:

- Родитель не видит IP ребёнка (и наоборот).
- Соединение работает за любым CGNAT/симметричным NAT.

---

## 11. Внутренние компоненты

### 11.1 Watchdog (pg_cron)

Backend **сам убирает зависшие сессии** — клиент не должен полагаться на вечно живущую сессию.

**Job `audio_session_watchdog`** (запускается каждую минуту):

```sql
-- Expire PENDING-сессии, не получившие child.ready за childReadyTimeoutSec
UPDATE audio_sessions
SET state = 'EXPIRED', ended_at = NOW()
WHERE state = 'PENDING'
  AND started_at < NOW() - INTERVAL '1 second' * (
    SELECT (value::int) FROM app_settings WHERE key = 'audio.childReadyTimeoutSec'
  );

-- Auto-END ACTIVE-сессии, чей durationSec истёк
UPDATE audio_sessions
SET state = 'ENDED', ended_at = NOW(),
    actual_sec = EXTRACT(EPOCH FROM (NOW() - active_at))::int
WHERE state = 'ACTIVE'
  AND active_at < NOW() - INTERVAL '1 second' * duration_sec;

-- Expire READY-сессии без answer более 5 минут
UPDATE audio_sessions
SET state = 'EXPIRED', ended_at = NOW()
WHERE state = 'READY'
  AND ready_at < NOW() - INTERVAL '5 minutes';
```

Клиенты (web-parent, mobile-parent) должны быть готовы получить SSE `EXPIRED` или `ENDED` в любой момент без явного действия со своей стороны.

### 11.2 Retention данных

| Таблица           | Retention | Механизм                            |
| ----------------- | --------- | ----------------------------------- |
| `audio_sessions`  | 90 дней   | pg_cron job `audio_session_cleanup` |
| `audit_log_audio` | 365 дней  | pg_cron job `audio_audit_cleanup`   |

Аудит-лог (год) нужен для compliance под 152-ФЗ — подтверждение факта обработки данных.

**Важно:** аудио НЕ хранится. Только метаданные (`startedAt`, `endedAt`, `actualSec`, `requestedBy`).

### 11.3 БД-схема

```sql
CREATE TABLE audio_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id         UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  requested_by     UUID NOT NULL REFERENCES users(id),
  state            TEXT NOT NULL,               -- PENDING|READY|ACTIVE|ENDED|FAILED|EXPIRED
  hidden_mode      BOOLEAN NOT NULL DEFAULT TRUE,
  duration_sec     INT NOT NULL,
  actual_sec       INT,                          -- NULL пока не ENDED
  failure_reason   TEXT,                         -- PERMISSION_DENIED | MIC_BUSY | ...
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  ready_at         TIMESTAMPTZ,
  active_at        TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  -- billing-заготовка (post-MVP):
  billable_minutes NUMERIC(5,2),
  cost_kopecks     INT
);

-- Защита от двойной активной сессии:
CREATE UNIQUE INDEX audio_sessions_active_child_idx
  ON audio_sessions (child_id)
  WHERE state IN ('PENDING', 'READY', 'ACTIVE');

-- Индекс для аудит-ленты:
CREATE INDEX audio_sessions_child_idx
  ON audio_sessions (child_id, started_at DESC);

CREATE TABLE audit_log_audio (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES audio_sessions(id),
  event         TEXT NOT NULL,  -- REQUESTED|GRANTED|DENIED|STARTED|STOPPED|FAILED
  actor_user_id UUID,
  actor_ip      INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 12. Privacy indicator (Android)

**Важно для mobile-child разработчика:**

На Android 12+ система **всегда** отображает зелёную точку в правом верхнем углу экрана и чип в quick-settings «Микрофон используется: GMD» когда приложение использует микрофон.

**Это нельзя обойти и не нужно пытаться.** Это системное требование Android Privacy Dashboard (Android 12+, API 31+).

**Последствия для UX:**

- Hidden mode по умолчанию означает: нет push ребёнку, нет уведомления в приложении GMD.
- **Но** система покажет индикатор микрофона. Ребёнок, который внимательно смотрит на статус-бар, увидит.
- В EULA родителя прописано: «Приложение использует микрофон устройства ребёнка. На Android 12+ при использовании микрофона система отображает системный индикатор».
- Это **by design** — честный компромисс между функциональностью для родителя и базовой приватностью ребёнка.

**FGS notification (обязательна):**
Android требует `startForeground` с notification при использовании `foregroundServiceType="microphone"`. Notification минималистична: иконка GMD + текст «Сервис активен». Она **не скрывает** факт работы микрофона, но и не кричит «родитель слушает».

---

## 13. Медиапараметры

Переговоры между child и parent происходят через SDP, но рекомендуемые параметры:

| Параметр         | Значение                         |
| ---------------- | -------------------------------- |
| Codec            | Opus                             |
| Sample rate      | 16 kHz                           |
| Channels         | Mono                             |
| Bitrate          | 24 kbps                          |
| DTX              | enabled (тишина не передаётся)   |
| FEC              | enabled (восстановление пакетов) |
| echoCancellation | true                             |
| noiseSuppression | true                             |
| autoGainControl  | true                             |

Видеотрека нет (`video: false` в constraints).

---

## 14. Checklist для разработчика mobile-child

При реализации `SoundAroundService` (Phase 5.3):

- [ ] Принять FCM push `audio.start` с полями `sessionId`, `durationSec`, `turn`
- [ ] Запросить `RECORD_AUDIO` если не выдано — **не запрашивать повторно**, при denied → `POST /error {code: "PERMISSION_DENIED"}`
- [ ] `ContextCompat.startForegroundService` → `startForeground` с `FOREGROUND_SERVICE_TYPE_MICROPHONE`
- [ ] `MediaConstraints { echoCancellation: true, noiseSuppression: true, autoGainControl: true }`
- [ ] `RTCPeerConnection` с force-relay TURN
- [ ] Создать SDP offer → `POST /child/audio/sessions/:id/ready {sdp}`
- [ ] Слушать FCM push `audio.answer` → `setRemoteDescription`
- [ ] Слушать FCM push `audio.ice` → `addIceCandidate`
- [ ] При `audio.stop` push → `stopSelf`
- [ ] При `durationSec` истёк → `stopSelf`
- [ ] При любой ошибке → `POST /child/audio/sessions/:id/error {code, message}` → `stopSelf`
- [ ] Не логировать SDP/ICE в Sentry/Crashlytics (privacy)
- [ ] Записать строку в DiagLog: `[timestamp] AUDIO_SESSION_STARTED parent_id=... session_id=...`
