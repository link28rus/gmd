# Realtime-канал сервер → телефон ребёнка (v0.57.0)

## Проблема

Команды телефону ребёнка (`START_AUDIO`, `STOP_AUDIO`, `PLAY_SIGNAL`, `BLOCK_APPS`,
`SYNC_RULES`, …) доставлялись тремя путями:

1. FCM high-priority push — нужен `FIREBASE_SA_KEY` на сервере;
2. RuStore Push — нужны `RUSTORE_PUSH_*` и установка из RuStore;
3. очередь `device_commands`, которую ребёнок забирает `GET /child/commands/pending`
   **только вместе с отправкой геолокации** — в покое раз в ~90 с (heartbeat-alarm).

После переезда прода (2026-09-27) ключей 1–2 нет, остался только poll. «Звук вокруг»
ждёт подключения ребёнка 45 с (`AUDIO_CHILD_READY_TIMEOUT_SEC`) — команда почти всегда
истекала раньше, чем телефон её забирал.

## Решение

Собственный постоянный WebSocket, который держит нативный код телефона. Он встроен
первым шагом в `FcmService.sendHybridDataMessage`, поэтому все существующие команды
ребёнку пошли через него без правок в вызывающем коде. FCM/RuStore остаются
запасными каналами (срабатывают, только если телефон не подтвердил получение),
очередь `device_commands` — последним.

```
родитель ─REST─► backend ──sendHybridDataMessage──► 0. realtime WS (ack ≤3с)
                                                     1. RuStore Push
                                                     2. FCM
                         └─ device_commands (poll вместе с геолокацией)
```

## Протокол

Адрес: `wss://<домен>/api/child/ws` (Caddy `handle_path /api/*` срезает префикс →
backend `/child/ws`). Авторизация — заголовок `X-Child-Token` (тот же device-token,
что в REST, проверка `ChildDeviceService.verifyToken`); неверный токен → close `4401`.

Сообщения — JSON-текст с полем `op`:

| Направление      | Сообщение                  | Смысл                                               |
| ---------------- | -------------------------- | --------------------------------------------------- |
| сервер → телефон | `{op:'hello'}`             | соединение принято                                  |
| сервер → телефон | `{op:'push', id, data}`    | `data` — тот же map строк, что уходит в FCM         |
| сервер → телефон | `{op:'ping'}`              | раз в 45 с                                          |
| телефон → сервер | `{op:'hello', appVersion}` | версия пишется в `child_devices.appVersion`         |
| телефон → сервер | `{op:'ack', id}`           | push получен                                        |
| телефон → сервер | `{op:'pong'}`              | ответ на ping, обновляет `child_devices.lastSeenAt` |

Правила:

- **Ack за 3 с** — иначе доставка считается неудачной, сокет рвётся (он, скорее всего,
  мёртвый), дальше пробуются RuStore/FCM, команда остаётся `pending` для poll.
- **Ack + `data.commandId`** → `device_commands.status = executed`, чтобы poll не выполнил
  команду второй раз. Для этого `START_AUDIO`/`STOP_AUDIO` теперь несут `commandId`.
- **Досылка при подключении**: `DeviceCommandsService.replayPendingOverRealtime` отдаёт
  непросроченные `pending` команды (`listPending` с дедупликацией START+STOP) —
  покрывает переключение сети в момент нажатия кнопки родителем.
- Одно соединение на устройство: новое вытесняет старое (close `4000 replaced`).
- Сервер рвёт клиента, молчащего дольше 105 с (2 пинга + запас).

## Телефон (mobile-child, нативный Kotlin)

- `ChildRealtimeClient` — OkHttp WebSocket, singleton. Старт из
  `LocationForegroundService.onCreate` (FGS геолокации живёт постоянно) и после
  `saveNativeCreds` (claim / запуск UI, переподключение со свежим токеном).
- Живость: heartbeat-alarm раз в 90 с вызывает `ensureConnected` — поднимает упавшее
  соединение и рвёт «тихое» (нет сообщений сервера >105 с). Смена сети
  (`registerDefaultNetworkCallback`) — немедленное переподключение. Backoff 1–60 с,
  при `4401` — 10 мин.
- `ChildPushDispatcher` — общий обработчик data-map для FCM и realtime (вынесен из
  `MyFirebaseMessagingService` без изменения логики). Для `START_AUDIO` сервис
  `SoundAroundService` уже в prewarm-состоянии FGS=microphone, поэтому старт из фона
  проходит так же, как у poll-пути.
- На время обработки push берётся wake lock на 10 с.

## Замеры (AVD Android 16, прод-backend, 2026-09-27)

От `POST /audio/sessions` до первого аудиокадра у родителя: 0,77 с (приложение открыто),
0,88 с (свёрнуто, экран выключен), 0,67 с (принудительный deep Doze), 0,71 с (после
переключения Wi-Fi → мобильная сеть; переподключение 0,6 с). Доставка push по каналу —
30–50 мс.

## Ограничения

- Если процесс приложения убит и FGS геолокации не поднят — канала нет, работает только
  poll (и FCM, если на сервере есть ключ).
- Prewarm микрофона по-прежнему требует хотя бы одного открытия приложения после
  перезагрузки (Android 14 запрещает стартовать FGS=microphone из фона).
- Расход батареи: пинг раз в 45 с поверх heartbeat геолокации раз в 90 с.
