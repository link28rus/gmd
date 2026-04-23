# GMD — «Звук вокруг ребёнка» (аудиомониторинг). Дизайн.

**Статус:** Draft
**Дата:** 2026-04-23
**Автор:** link28rus + Claude
**Аналог:** Findmykids «Sound Around Child» / «Где мои дети» «Звук вокруг»
**Связанные:** [MVP-design](2026-04-18-gmd-mvp-design.md), [Phase 3 mobile-child](2026-04-20-gmd-phase3-mobile-child-design.md), [Phase 1.2.5 privacy-consent](2026-04-19-gmd-phase1.2.5-privacy-consent-design.md)

---

## 1. Цель и контекст

Дать родителю возможность по запросу прослушать звук окружения с устройства ребёнка в режиме, близком к реальному времени (≤ 1 сек latency). Use case — кризисные ситуации (буллинг, ребёнок не отвечает на звонок, проверка «дошёл ли до школы»).

Включается в MVP по решению пользователя 2026-04-23 (см. memory-compiler `decision_research__реализация__звук_вокруг_ребёнка__у_findm.md`). До этого фича была явно исключена из MVP — соответствующие пункты в [CLAUDE.md](../../../CLAUDE.md) и [MVP-design](2026-04-18-gmd-mvp-design.md) удалены.

## 2. Scope

### В Scope

- Live-аудио с child-устройства → parent-устройство через WebRTC.
- Только Android на стороне ребёнка (foreground service `microphone` + `RECORD_AUDIO`).
- Parent-сторона: web-кабинет (HTML5 WebRTC) + mobile-parent (Flutter `flutter_webrtc`).
- TURN-сервер на нашей инфре (coturn в docker-compose).
- Hidden-mode по умолчанию (без push/баннера ребёнку), с system-level privacy indicator (зелёная точка Android — снять нельзя).
- Длительность одной сессии — **5 мин** по умолчанию, регулируется в админке (1–30 мин).
- Аудит-журнал: каждая попытка и каждая успешная сессия пишется в `audit_log`.
- Лимит на MVP — отсутствует (∞ минут). Billing-метка заложена в схеме на будущее.
- OEM-wizard (Xiaomi/HyperOS, Honor MagicOS) для Background mic + Restricted settings.
- EULA / политика конфиденциальности обновляются: явное согласие на «прослушку без оповещения ребёнка».

### НЕ в Scope (post-MVP)

- Запись клипов и хранение в MinIO. На MVP — только live, ничего не сохраняется на сервере (только метаданные сессии).
- Тарификация / биллинг. Поля заложены, UI/payments — потом.
- iOS на стороне ребёнка (нет mobile-child под iOS вообще).
- Двусторонняя голосовая связь (push-to-talk родителя). Только mute-микрофон родителя.

## 3. UX-flow

### 3.1 Parent (web-кабинет)

```
[Карта ребёнка] → клик «Звук вокруг» → диалог «Подтвердить прослушку»
   ├─ Принять
   │     ↓
   │   [Loading 1-3 сек] — backend отправляет push, child-app поднимает FGS
   │     ↓
   │   [Audio player + waveform + таймер 04:59 / 05:00]
   │     ├─ кнопка «Стоп»
   │     ├─ автостоп через 5 мин
   │     └─ ошибка «Ребёнок offline» / «Микрофон занят» / «Permission denied»
   └─ Отмена
```

### 3.2 Parent (mobile)

Аналогично web, через `flutter_webrtc`. Audio выводится в speakerphone по умолчанию (не earpiece), tap-to-toggle.

### 3.3 Child (mobile-child)

**По умолчанию hidden-mode:**

- Никакого push, никакого баннера в app.
- Появляется **только system-level privacy indicator Android 12+** (зелёная точка справа сверху + чип в quick-settings «Микрофон используется: GMD»). Это нельзя обойти, требование Android Privacy Dashboard.
- В DiagLog (доступ через long-press на версии в /debug) пишется запись `[2026-04-23 12:34:56] AUDIO_SESSION_STARTED parent_id=...` для возможного аудита.

**Опциональный режим (тумблер в child-app настройках, по умолчанию OFF):**

- «Уведомлять меня когда родитель слушает» → если ON, появляется push + persistent notification «Родитель сейчас слушает».

## 4. Архитектура

### 4.1 Компоненты

```
┌──────────────┐                    ┌─────────────────────┐
│  web/mobile  │ ◀── WebRTC P2P ──▶ │  mobile-child       │
│  parent      │   (через TURN)     │  (FGS microphone)   │
└──────┬───────┘                    └─────────┬───────────┘
       │                                      │
       │   REST + SSE signaling               │   REST + push
       │                                      │
       └──────────┬───────────────────────────┘
                  ▼
          ┌──────────────────┐
          │  backend (NestJS)│
          │  - sessions API  │
          │  - signaling     │
          │  - push trigger  │
          │  - audit         │
          └─────┬────────┬───┘
                │        │
         ┌──────▼──┐  ┌──▼──────┐
         │ Postgres│  │ coturn  │
         │ + audit │  │ (TURN)  │
         └─────────┘  └─────────┘
```

### 4.2 Sequence

```
parent              backend           push (FCM)        child            TURN
  │                    │                  │              │                │
  │─POST /audio/start─▶│                  │              │                │
  │                    │─create session───▶│             │                │
  │                    │  (id, expires)   │              │                │
  │                    │─push "audio.start"───────────▶  │                │
  │                    │                  │              │                │
  │◀─SSE/long-poll─────│                  │              │                │
  │  {state: PENDING}  │                  │              │                │
  │                    │                  │              │─FGS up + mic──▶│ (allocate)
  │                    │◀──POST /audio/{id}/ready────────│                │
  │                    │ (offer SDP)      │              │                │
  │◀─SSE event─────────│                  │              │                │
  │  {state:READY,sdp} │                  │              │                │
  │─POST answer SDP───▶│                  │              │                │
  │                    │─push answer───────────────────▶│                 │
  │                                                                       │
  │ ◀═══════════════════ WebRTC P2P audio (через TURN) ═══════════════════▶│
  │                                                                       │
  │─POST /audio/{id}/stop──▶│                            │                │
  │                    │─push "audio.stop"────────────▶│                  │
  │                    │                  │            │─FGS down────────│
```

### 4.3 Почему WebRTC, а не клипы

- Latency 200-500 мс vs 5-15 сек — критично для use case «слышать вживую».
- Аудио **не хранится** на нашей стороне — приватнее, дешевле по storage, проще под 152-ФЗ (нет «обработки записей»).
- Минусы (TURN-сервер, ICE, debug сложнее) — компенсируются `flutter_webrtc` и зрелым стеком.

## 5. WebRTC pipeline

### 5.1 Стек

- **Backend signaling:** REST + Server-Sent Events. SSE на endpoint `/api/audio/sessions/{id}/events` для parent. Push-уведомления для child.
- **TURN:** `coturn` в `infra/docker/docker-compose.prod.yml`. UDP 3478 + TLS 5349. Креды — short-lived (issued backend через REST, TTL 10 мин, HMAC по shared secret).
- **Параметры медиа:** один аудио-трек, кодек **Opus** 16 kHz mono, bitrate 24 kbps, DTX on, FEC on. Без видео.
- **Mobile-child:** `flutter_webrtc` или native Android `org.webrtc:google-webrtc`. Захват: `AudioSource` с `MediaConstraints { echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.

### 5.2 ICE и NAT

TURN обязателен (мобильный CGNAT/симметричные NAT). На MVP не делаем STUN-only (≈30% соединений упадут). coturn-конфиг: relay-only forced для child→parent, чтобы не светить parent IP.

### 5.3 Безопасность

- DTLS-SRTP (стандарт WebRTC).
- TURN-креды — per-session, TTL 10 мин, генерация: `username = ts:session_id`, `password = HMAC_SHA1(ts:session_id, TURN_SECRET)`.
- SDP offer/answer передаются через наш backend (signaling), не peer-to-peer напрямую.

## 6. Backend API

OpenAPI-фрагмент (полная спека после ревью):

### 6.1 Endpoints

```
POST   /api/audio/sessions
  body: { childId, requestedDurationSec? }   // default из admin-settings
  response 201: { id, state:PENDING, expiresAt, turnCreds:{url,username,password,ttl} }
  errors: 403 (no access to child), 409 (другая активная сессия для этого child), 429

GET    /api/audio/sessions/{id}/events       // SSE
  events: state-change, sdp-offer, ice-candidate, error, expired

POST   /api/audio/sessions/{id}/answer
  body: { sdp }                              // SDP answer от parent

POST   /api/audio/sessions/{id}/ice
  body: { candidate }

POST   /api/audio/sessions/{id}/stop
  response 204

# Child-side (device-token JWT):
POST   /api/audio/sessions/{id}/ready
  body: { sdp }                              // SDP offer от child

POST   /api/audio/sessions/{id}/ice
  body: { candidate }

POST   /api/audio/sessions/{id}/error
  body: { code, message }                    // PERMISSION_DENIED | MIC_BUSY | OEM_BLOCKED

# Admin:
GET    /api/admin/settings/audio
PATCH  /api/admin/settings/audio
  body: { defaultDurationSec, maxDurationSec, hiddenModeAllowed, ... }

GET    /api/admin/audio/sessions             // аудит-лента
```

### 6.2 Состояния сессии

```
PENDING → push отправлен, ждём child.ready
READY   → child прислал offer, ждём parent.answer
ACTIVE  → обмен ICE состоялся, аудио идёт
ENDED   → штатное завершение (parent stop / истечение duration)
FAILED  → ошибка (timeout, mic_busy, oem_blocked, permission_denied)
EXPIRED → child не ответил за TIMEOUT_SEC (default 15)
```

## 7. БД-схема

```sql
CREATE TABLE audio_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id        UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES users(id),       -- родитель
  state           TEXT NOT NULL,                            -- PENDING|READY|ACTIVE|ENDED|FAILED|EXPIRED
  hidden_mode     BOOLEAN NOT NULL DEFAULT TRUE,            -- ребёнок НЕ уведомлён в app
  duration_sec    INT NOT NULL,                             -- запрошенная длительность
  actual_sec      INT,                                      -- реальная длительность (NULL пока ACTIVE)
  failure_reason  TEXT,                                     -- если FAILED
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ready_at        TIMESTAMPTZ,
  active_at       TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  -- billing-заготовка (не используется на MVP):
  billable_minutes NUMERIC(5,2),                            -- округление вверх до минуты, post-MVP
  cost_kopecks     INT                                      -- post-MVP
);

CREATE INDEX audio_sessions_child_idx ON audio_sessions (child_id, started_at DESC);
CREATE INDEX audio_sessions_active_idx ON audio_sessions (child_id) WHERE state IN ('PENDING','READY','ACTIVE');

CREATE TABLE audit_log_audio (                            -- отдельный аудит для compliance
  id           BIGSERIAL PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES audio_sessions(id),
  event        TEXT NOT NULL,                             -- REQUESTED|GRANTED|DENIED|STARTED|STOPPED|FAILED
  actor_user_id UUID,
  actor_ip     INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- admin settings (одна строка с настройками сервиса):
ALTER TABLE app_settings ADD COLUMN audio JSONB DEFAULT '{
  "defaultDurationSec": 300,
  "maxDurationSec": 1800,
  "minDurationSec": 30,
  "hiddenModeAllowed": true,
  "concurrentSessionsPerChild": 1
}';
```

Retention: `audio_sessions` хранятся 90 дней, `audit_log_audio` — 1 год (требование под аудит). pg_cron job `audio_session_cleanup`.

## 8. Mobile-child реализация

### 8.1 AndroidManifest

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<service
    android:name=".audio.SoundAroundService"
    android:foregroundServiceType="microphone"
    android:exported="false" />
```

### 8.2 Жизненный цикл сервиса

1. Push `audio.start` приходит → `FirebaseMessagingService.onMessageReceived`.
2. Стартуем `SoundAroundService` через `ContextCompat.startForegroundService`.
3. В `onStartCommand` — `startForeground(NOTIF_ID, buildSilentNotification(), FOREGROUND_SERVICE_TYPE_MICROPHONE)`.
4. Notification — **минималистичная, без явного текста про прослушку** (т.к. hidden-mode default). Текст: «Сервис активен» / иконка GMD. Это формальное требование Android — уведомление должно быть, но можно сделать generic.
5. WebRTC peer-connection setup, отправка `POST /api/audio/sessions/{id}/ready` с offer.
6. Получение answer + ICE через push (fallback) или REST polling.
7. По истечении `duration_sec` или push `audio.stop` → `stopSelf`.

### 8.3 Обработка отказов

| Сценарий                             | Действие                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `RECORD_AUDIO` denied                | `POST /sessions/{id}/error code=PERMISSION_DENIED`. Не перезапрашиваем — родитель увидит ошибку в кабинете. |
| Микрофон занят (звонок, диктофон)    | `code=MIC_BUSY`, retry policy на parent-стороне.                                                            |
| OEM убил FGS (HyperOS battery saver) | `code=OEM_BLOCKED` (если успели до kill), либо timeout EXPIRED.                                             |
| Push не дошёл                        | timeout 15 сек на стороне backend → state=EXPIRED.                                                          |

### 8.4 Защита от удаления

Существующий механизм Device Admin (см. v0.29.x lessons) — наследуем. При попытке удалить app пока активна сессия — стандартный Device Admin блок.

## 9. Mobile-parent / web реализация

### 9.1 Web (`apps/web`)

- Кнопка «Звук вокруг» в карточке ребёнка на карте.
- Modal с подтверждением → инициализация `RTCPeerConnection`, `<audio autoplay controls={false}>`.
- Waveform: `<canvas>` + `AnalyserNode` от `Web Audio API`.
- SSE-подписка на `/api/audio/sessions/{id}/events`.
- Auto-stop таймер.

### 9.2 Mobile-parent (`apps/mobile-parent`)

- `flutter_webrtc` для PeerConnection.
- `wakelock_plus` пока сессия активна (не давать экрану гаснуть).
- AudioSession в speakerphone.

## 10. Privacy и юридическая часть (152-ФЗ)

### 10.1 Изменения в политике конфиденциальности

Добавить раздел «Аудиомониторинг»:

- Что: микрофон ребёнка может быть включён родителем по запросу.
- Как: только через child-app, только в активной парной связке, с system-level индикатором Android.
- Хранение: аудио НЕ хранится на серверах GMD. Хранятся только метаданные сессии (время, длительность, родитель-инициатор) — для аудита, 1 год.
- Уведомление ребёнка: по умолчанию **не уведомляется** в приложении. Возможно включить в настройках child-app.

### 10.2 Согласие при онбординге

- При установке mobile-child (claim invite) — отдельный экран «Согласие на аудиомониторинг», галочка обязательна для продолжения. Текст хранится с версией в `consent_versions` таблице.
- Для ребёнка 14+ — согласие подписывается им лично (как уже сделано для основной обработки ПДн в Phase 1.2.5).

### 10.3 Право на отзыв

- В child-app настройках — переключатель «Разрешить родителю включать аудиомониторинг». Если OFF, попытка parent → 403.
- При отзыве пишется в `audit_log_audio` event=`CONSENT_REVOKED`.

### 10.4 Уведомление РКН

В обновлённом уведомлении РКН перед публичным запуском прописать новую категорию обработки: «голосовые/звуковые данные несовершеннолетних — обработка в реальном времени без хранения».

## 11. OEM-wizard

Расширить существующий permission-wizard mobile-child:

- **Xiaomi / HyperOS:** «Карточка приложения → ⋮ → Разрешить ограниченные настройки → Закрепить в фоне» + «Контроль активности → Без ограничений».
- **Honor MagicOS:** «Запуск приложений → ручное управление → разрешить автозапуск + работу в фоне».
- **Samsung OneUI:** «Без ограничений батареи».
- **Stock Android 14+:** ничего сверх RECORD_AUDIO.

Wizard вызывается **один раз при установке** (как существующие wizard'ы из v0.29.x). Если пропущен — повторно при первом FAILED audio session с `code=OEM_BLOCKED`.

## 12. Тарификация (заложить, не использовать на MVP)

- В таблице `audio_sessions` есть поля `billable_minutes`, `cost_kopecks` — заполняются при ENDED.
- В `app_settings.audio` заложить флаг `billing.enabled = false`.
- При биллинге post-MVP: округление up до минуты, тариф из `app_settings.audio.tariff` (kopecks/min), баланс — отдельная таблица `audio_balance(user_id, kopecks_remaining)`.
- На MVP — UI ничего не показывает, бесплатно.

## 13. Админ-настройки (`/admin/settings/audio`)

| Поле                         | Тип    | Default                         | Диапазон |
| ---------------------------- | ------ | ------------------------------- | -------- |
| `defaultDurationSec`         | int    | 300                             | 30–1800  |
| `maxDurationSec`             | int    | 1800                            | 60–3600  |
| `minDurationSec`             | int    | 30                              | 10–600   |
| `hiddenModeAllowed`          | bool   | true                            | —        |
| `concurrentSessionsPerChild` | int    | 1                               | 1–3      |
| `turnUrl`                    | string | turn:turn.gmd.link28rus.ru:3478 | —        |

Изменения логируются в `app_settings_audit`.

## 14. Phasing

Разбивка на фазы (детальные плейны — отдельно через `writing-plans`):

| Phase   | Содержание                                                                               | Оценка |
| ------- | ---------------------------------------------------------------------------------------- | ------ |
| **5.1** | Infra: coturn в docker-compose, TLS-сертификаты, проброс портов                          | 1д     |
| **5.2** | Backend: схема БД, sessions API, signaling endpoints, push-trigger, TURN-creds endpoint  | 2-3д   |
| **5.3** | Mobile-child: FGS microphone, WebRTC capture, push-handler, OEM-wizard расширение        | 3-4д   |
| **5.4** | Web-parent: UI карточки, modal, RTCPeerConnection, SSE, waveform                         | 2д     |
| **5.5** | Mobile-parent: `flutter_webrtc` integration, audio output, wakelock                      | 2д     |
| **5.6** | Privacy/EULA: обновление политики, claim-invite экран согласия, child-app тумблер отзыва | 1-2д   |
| **5.7** | Admin: настройки `/admin/settings/audio`, аудит-лента                                    | 1д     |
| **5.8** | E2E-тесты, OEM verification (Xiaomi реальное устройство), нагрузочный тест coturn        | 2д     |

**Итого:** ~15-18 рабочих дней.

## 15. Risks / Open questions

| Риск                                                                | Митигейшн                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OEM убивает FGS до того как WebRTC поднимется                       | Pre-warm child-app при старте дня (фоновый ping раз в час), плюс OEM-wizard.               |
| WebRTC behind CGNAT не подключается через STUN                      | Force-relay TURN, на MVP принимаем.                                                        |
| Юр. иск от ребёнка 14+                                              | EULA + claim-invite consent + тумблер отзыва. Документировано в политике.                  |
| Privacy indicator пугает ребёнка → рассказывает родителю → конфликт | Это by design Android. Оговорить в EULA «приложение может проявлять активность микрофона». |
| Audio leak в логи / Sentry                                          | DSN сконфигурирован: НЕ отправлять SDP/ICE в breadcrumbs.                                  |
| Child-app не запущен (force-stopped)                                | Push не доходит → state=EXPIRED. UI родителя: «Ребёнок offline, попробуйте позже».         |

**Open questions:**

1. Нужна ли запись сессии для родителя (download MP3 после)? — На MVP **нет** (сложнее по 152-ФЗ + storage). Решить post-MVP.
2. Двусторонний голос (push-to-talk родителя) — post-MVP.
3. Параллельные сессии нескольких родителей одного ребёнка — на MVP блокируем (`concurrentSessionsPerChild=1`).

## 16. Источники

- Memory: `decision_research__реализация__звук_вокруг_ребёнка__у_findm.md` (2026-04-23 research)
- [findmykids.org/features/sound-around-child](https://findmykids.org/features/sound-around-child)
- [gdemoideti.ru блог](https://gdemoideti.ru/blog/ru/pochemu-my-razreshaem-detyam-vyklyuchat-zvuk-vokrug)
- Android Privacy Indicators (12+): developer.android.com/training/permissions/explaining-access
- Android 14 FGS microphone type: developer.android.com/about/versions/14/changes/fgs-types-required
- WebRTC + coturn reference: github.com/coturn/coturn
