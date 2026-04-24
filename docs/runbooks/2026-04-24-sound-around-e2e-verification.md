# «Звук вокруг» — E2E verification runbook (Plan E)

**Дата составления:** 2026-04-24
**Версии:** backend v0.34.1, web v0.34.1, mobile-child v0.33.1
**Среда:** prod (`gmd-prod` / `85.15.75.126` / роутер → 192.168.1.23)
**Тестовое устройство:** Xiaomi HyperOS, Android 15, arm64

## 0. Предусловия (заполняется перед прогоном)

Отметь что готово. Если хоть один пункт не ✅ — не начинай прогон, пофиксь сначала.

- [ ] `ssh gmd-prod 'docker ps --format "{{.Names}}"' | grep gmd-coturn` → `gmd-coturn`
- [ ] `ssh gmd-prod 'ss -ulnp | grep 3478'` → `udp UNCONN ... :3478` (UDP-лисенер есть)
- [ ] Внешний проброс: с внешней машины `nc -u 85.15.75.126 3478` + отправка любых байт → пакет доходит до coturn. Альтернатива: `adb logcat | grep WebRTC` в Plan B должен показывать `ice candidate type=relay raddr 85.15.75.126` в момент сессии
- [ ] `curl https://gmd.link28rus.ru/api/readyz` → `{"status":"ok","db":"up","redis":"up"}`
- [ ] Web-версия в sidebar/About: `0.34.1` (значит deploy прошёл и UI обновился)
- [ ] APK `app-arm64-v8a-release.apk` установлен на Xiaomi поверх старого (без `flutter install` — через файловый менеджер или `adb install -r`)
- [ ] В mobile-child пройден permission wizard: RECORD_AUDIO granted, FGS microphone ok, Device Admin включён, Accessibility включён, HyperOS «Ограниченные настройки» разрешены, автозапуск в фоне разрешён
- [ ] Xiaomi привязан к parent-аккаунту `link28rus@ya.ru` через QR-invite (child виден в /cabinet/)
- [ ] Chrome DevTools открыт (Network + Console) на вкладке `/cabinet/` с аккаунтом `link28rus@ya.ru`

## 1. Sanity checks (выполняет claude перед user-тестами)

### 1.1 TURN-кредсы генерируются

```bash
# С локалки, получить JWT через /api/auth/login, потом:
curl -X POST https://gmd.link28rus.ru/api/audio/sessions \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"childId":"<CHILD_ID>","durationSec":60,"hiddenMode":true}' | jq
```

Ожидаемо: HTTP 201, body с `turnCreds.url = "turn:85.15.75.126:3478"`, `username`, `password`, `ttl: 360`. Сразу после этого запроса сессия в state PENDING и child должен получить START_AUDIO через ближайший poll.

### 1.2 Coturn принимает эти кредсы

```bash
# Локально или с сервера — попробовать TURN allocate с теми же кредсами:
turnutils_uclient -v -t -u <username> -w <password> 85.15.75.126 2>&1 | head -30
# Если turnutils_uclient нет: использовать webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# — вставить url/username/credential из turnCreds → должны появиться relay candidates с IP 85.15.75.126
```

Ожидаемо: allocation succeeded, relay candidate с host 85.15.75.126.

### 1.3 SSE endpoint жив

```bash
curl -N -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "https://gmd.link28rus.ru/api/audio/sessions/<SESSION_ID>/events"
```

Ожидаемо: соединение открывается, ответ `text/event-stream`, шлёт `data: {"state":"PENDING",...}` и остаётся висеть до child-response / timeout 45s.

## 2. Happy path (полный цикл)

### 2.1 Подготовка логов

Параллельно открыть 3 окна:

**Terminal A (backend logs):**

```bash
ssh gmd-prod 'docker logs -f gmd-backend --tail 0'
```

**Terminal B (coturn logs):**

```bash
ssh gmd-prod 'docker logs -f gmd-coturn --tail 0'
```

**Terminal C (device logcat):** на компьютере с подключённым по USB Xiaomi:

```bash
adb logcat -c && adb logcat -s SoundAroundService:V FlutterWebRTC:V flutter:V DiagLog:V
```

### 2.2 Сценарий

1. **[web]** `/cabinet` → найти тест-ребёнка → раскрыть меню → клик «Звук вокруг».
   - Ожидание: модалка открывается, статус «Создаём сессию…» → «Ожидаем ответ от устройства ребёнка…», timer `00:00 / 05:00`.
   - **DevTools Network:** `POST /api/audio/sessions` → 201, `GET /api/audio/sessions/<id>/events` → pending (SSE открыт).
   - **Backend log:** `[AudioService] startSession childId=... sessionId=...`, `[DeviceCommands] enqueueAudioStart`.

2. **[device]** Xiaomi в течение 0-30 сек выполняет next poll (ожидание).
   - **Logcat:** `[CommandHandler] handleCommand type=START_AUDIO sessionId=...`, `[SoundAroundService] onStartCommand`, `[FlutterWebRTC] createOffer`, `[SoundAroundController] sendReady`.
   - **Privacy indicator:** зелёная точка Android в правом верхнем углу экрана устройства.

3. **[backend]** Приходит POST `/child/audio/sessions/<id>/ready` с SDP-offer.
   - **Backend log:** `childReady received sdp length=... sessionId=...`.
   - **SSE parent:** `data: {"state":"READY","payload":{"sdp":"v=0..."}}`.

4. **[web]** Дialog status меняется на «Устанавливаем соединение…».
   - **DevTools Network:** `POST /api/audio/sessions/<id>/answer` → 204. Параллельно трикл `POST /api/audio/sessions/<id>/ice` (по 5-15 раз).
   - **Coturn log:** `new connection ... from 85.15.75.126:xxxxx` для parent и для child.

5. **[web]** Dialog status → «Подключено». Таймер тикает `00:01 / 05:00 ... 00:10 / 05:00 ...`.
   - **Звук:** пользователь говорит в микрофон Xiaomi — слышно из динамиков ноутбука. VU-meter прыгает.

6. **[web]** Клик «Остановить».
   - **DevTools Network:** `POST /api/audio/sessions/<id>/stop` → 204.
   - **SSE:** `data: {"state":"ENDED","payload":{"actualSec":N}}`.
   - **Backend log:** `parentStop sessionId=...`, `enqueueAudioStop`.
   - **Logcat device:** `[CommandHandler] handleCommand type=STOP_AUDIO`, `[SoundAroundService] onDestroy`.
   - Privacy indicator исчезает. Модалка закрывается (или остаётся в состоянии «Сессия завершена»).

**✅ Happy path пройден, если:** все 6 пунктов прошли без ошибок, аудио было слышно, VU-meter реагировал, никто в логах не ругался на HMAC/DTLS/ICE.

## 3. Edge cases

### 3.1 Child offline → EXPIRED

1. На Xiaomi включить **авиарежим**.
2. Web → «Звук вокруг» → ждать 45 сек.
3. Ожидание: `data: {"state":"EXPIRED","payload":null}` через SSE. UI: «Устройство не отвечает». Toast «Устройство ребёнка не отвечает…».
4. **Backend log:** `watchdog: session expired id=... reason=child_ready_timeout`.

### 3.2 Mic busy → FAILED

1. На Xiaomi **запустить голосовой диктофон** (удерживает микрофон).
2. Web → «Звук вокруг».
3. Ожидание: `data: {"state":"FAILED","payload":{"reason":"MIC_BUSY"}}`. UI: «Микрофон занят другим приложением (например, звонком)». Toast.
4. **Backend log:** `childError code=MIC_BUSY`.

### 3.3 OEM-kill (HyperOS restricted)

1. В настройках HyperOS отозвать «Автозапуск в фоне» для GMD.
2. На устройстве force-stop приложения GMD (swipe → Force stop).
3. Web → «Звук вокруг» → ждать 45 сек.
4. Ожидание: `EXPIRED` (push не дошёл до процесса, т.к. процесс убит и HyperOS не запускает).
5. UI: «Устройство не отвечает». Документируем: это именно OEM-block сценарий.

### 3.4 Двойная сессия → 409

1. Открыть один web-tab → «Звук вокруг» (сессия ACTIVE).
2. Открыть второй tab того же аккаунта → «Звук вокруг».
3. Ожидание: второй запрос `POST /api/audio/sessions` → **HTTP 409** с кодом `ACTIVE_SESSION_EXISTS`. UI второго tab'а: «Ошибка соединения» (или более понятный fail-label — см. Plan C findings для v0.34.2).

### 3.5 Автостоп по duration

1. Web → «Звук вокруг» → дождаться `ACTIVE`.
2. Не трогать. Ждать 05:00.
3. Ожидание: таймер достигает 05:00, модалка шлёт `POST /stop` сама, backend → ENDED.
4. UI: «Сессия завершена». Kein toast.

### 3.6 Потеря SSE (закрытие DevTools / реконнект)

1. Web → «Звук вокруг» → ждать ACTIVE.
2. В DevTools Network → убить запрос `/events` (контекстное меню → Cancel).
3. Ожидание: хук `useAudioSse` логирует error, UI идёт в `failed`, сессия на backend всё ещё ACTIVE до auto-stop.
4. **Это известный гап:** reconnect SSE не реализован (plan спорил об этом, оставили на post-MVP). Ожидаемо `failed`.

## 4. Что фиксировать при багах

На каждый fail собрать:

1. **Скриншот UI** (+ времена).
2. **DevTools**: полная лента Network (Preserve log включить!), Console (все errors).
3. **Backend logs:** `ssh gmd-prod 'docker logs gmd-backend --since 5m'`.
4. **Coturn logs:** `ssh gmd-prod 'docker logs gmd-coturn --since 5m'`.
5. **Logcat device:** последние 500 строк `adb logcat -d -t 500`.
6. **DiagLog mobile-child:** long-press на версии на экране `/debug` → «Copy all» → paste.
7. **Session id** из backend-логов / DevTools.

Присылать как один чеклист:

```
Сценарий: 3.2 MIC_BUSY
Session id: <uuid>
Fail: <что не так>
Время: HH:MM
Прикреплены: screenshot.png, devtools-network.har, backend.log, coturn.log, logcat.txt, diaglog.txt
```

## 5. Post-run — что зафиксировать в memory

После прогона всех сценариев — `finish_task` с описанием:

- Какие сценарии прошли ✅ и какие fail ❌.
- Обнаруженные баги (ссылки на issue/commit если фиксились).
- Performance observations: время latency `READY → ACTIVE`, bitrate, CPU/battery на Xiaomi.
- Рекомендации для Plan D (consent-UX) и на post-MVP: reconnect SSE, более гибкие OEM-инструкции.
