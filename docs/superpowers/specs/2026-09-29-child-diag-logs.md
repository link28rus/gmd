# Журнал приложения ребёнка на сервере (v0.60.0)

## Зачем

Диагностический журнал `DiagLog` телефона ребёнка (файл `periscop-diag.log`, пишут Kotlin и оба
Dart-изолята) сейчас виден только на экране `/debug` самого телефона. Когда телефона нет под рукой
(сентябрь 2026: «Звук вокруг» не стартует у двух детей, причину не подтвердить), нужен журнал на
сервере: по запросу из админки и автоматически при сбоях. Состав журнала настраивается для
каждого телефона и после отладки выключается.

## Решения

- Смотрит журналы только администратор (`/admin/children/<id>/diag`). В журнале бывают координаты
  и события, поэтому родителям он не показывается. Хранение — 14 дней, не больше 30 журналов на
  устройство (чистка при каждой новой загрузке).
- Настройки — состояние, не команда: лежат в `child_devices.diagConfig` (JSONB, `null` = значения
  по умолчанию), телефон получает их по мгновенному каналу при каждом подключении и сразу после
  изменения, плюс `GET /child/diag/config` при старте службы геолокации.
- Запрос журнала — команда `UPLOAD_DIAG` в очереди `device_commands` с TTL **24 ч**: телефон не на
  связи → команда уйдёт при подключении (досылка в `replayPendingOverRealtime`).
- Старые версии приложения (< 0.60.0) команду не понимают — в админке подсказка.

## Настройки (`DiagConfig`)

```ts
type DiagCategory = 'audio' | 'location' | 'realtime' | 'push' | 'update' | 'system' | 'other';

interface DiagConfig {
  send: DiagCategory[]; // какие категории попадают в отправляемый журнал
  debug: DiagCategory[]; // для каких категорий писать подробные (DEBUG) записи
  debugUntil: string | null; // ISO-время, после которого подробный режим сам выключается; null = бессрочно
  logcat: boolean; // прикладывать системный logcat своего процесса
  snapshot: boolean; // прикладывать снимок состояния телефона
  autoUpload: boolean; // сам отправлять журнал при сбоях
}

const DEFAULT_DIAG_CONFIG: DiagConfig = {
  send: ['audio', 'location', 'realtime', 'push', 'update', 'system', 'other'],
  debug: [],
  debugUntil: null,
  logcat: false,
  snapshot: true,
  autoUpload: true,
};
```

Подробный режим активен для категории, если она в `debug` и (`debugUntil == null` или
`now < debugUntil`). Обычные (INFO) записи пишутся всегда — поведение экрана `/debug` не меняется.
Фильтр `send` применяется при отправке.

### Категории по тегам записей (телефон)

| Категория  | Теги                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `audio`    | `sound`, `sound_around`, `audio_trampoline`, `signal`, `sa_bg`, `SoundAround`, `AudioCommandHandler`                  |
| `location` | `bg`, `ingestor`, `activity`, `svc`, `heartbeat-recv`, `motion`                                                       |
| `realtime` | `realtime`                                                                                                            |
| `push`     | `fcm`, `rustore`, `fcm_token_refresh_worker`, `poll`, `fcm_registrar`, `rustore_push_registrar`, `app_control_http`   |
| `update`   | `updates`, `post_update_guard`                                                                                        |
| `system`   | `boot`, `restart`, `admin`, `escape`, `escape_probe_worker`, `native`, `ui`, `crash`, `diag`, `app_control_scheduler` |
| `other`    | всё остальное (в т.ч. `dart` — тег Dart по умолчанию)                                                                 |

Теги сравниваются без учёта регистра. Реализация — `DiagConfig.kt` (`DiagCategories.forTag`).

Формат строки: `MM-dd HH:mm:ss.SSS L [tag] msg`, где `L` — `I` или `D`.

## Протокол

### Мгновенный канал (сервер → телефон, `{op:'push', data}`)

- `{type:'DIAG_CONFIG', config:'<DiagConfig JSON-строкой>'}` — при каждом подключении телефона и
  после `PATCH` настроек. В очередь команд не кладётся.
- `{type:'UPLOAD_DIAG', commandId}` — запрос журнала (из `device_commands`, тип `UPLOAD_DIAG`).

### Телефон → сервер

- `GET /child/diag/config` (ChildAuthGuard) → `DiagConfig` (с подставленными умолчаниями).
- `POST /child/diag/logs` (ChildAuthGuard, JSON, допускается `Content-Encoding: gzip`, лимит 20 в час):

  ```json
  {
    "reason": "manual" | "auto",
    "trigger": "audio_start_failed",   // ≤64 символов, для auto
    "commandId": "…",                  // для manual
    "appVersion": "0.60.0+N",          // ≤32
    "snapshot": "…",                   // ≤64 КБ
    "log": "…",                        // ≤2 МБ
    "logcat": "…"                      // ≤2 МБ
  }
  ```

  → `201 {id}`. Если есть `commandId` — команда помечается `executed`.

Автоотправка на телефоне: не чаще раза в 30 мин на один `trigger`, не больше 6 в сутки; через
WorkManager с ограничением «есть сеть» — журнал уйдёт, когда появится интернет.

Ожидаемые сбои лимит не расходуют: телефон не привязан (некуда слать) или нет RECORD*AUDIO
(для `audio*\*` — идёт мастер разрешений).

Автоматические триггеры: `audio_prewarm_failed` (служба микрофона не поднялась, в т.ч. после
обновления или перезагрузки), `audio_start_failed` (START_AUDIO не смог запустить запись),
`audio_stream_failed` (Dart-сторона не подключилась к аудиоканалу / упал AudioRecord), `crash`
(необработанное исключение — запись в журнал сразу, отправка при следующем запуске).

### Администратор

- `GET /admin/children/:id/diag` →
  `{device: {id, appVersion, lastSeenAt, online} | null, config, pendingRequest: {commandId, createdAt, expiresAt} | null, uploads: [{id, reason, trigger, appVersion, sizeBytes, createdAt}]}`
- `PATCH /admin/children/:id/diag/config` (полный `DiagConfig`) → `{config, delivered}`
- `POST /admin/children/:id/diag/request` → `{commandId, delivered, expiresAt}`
- `GET /admin/diag/uploads/:uploadId` → `{id, childId, reason, trigger, commandId, appVersion, sizeBytes, createdAt, snapshot, log, logcat}`
- `DELETE /admin/diag/uploads/:uploadId` → `{ok: true}`

## Данные

- `child_devices.diagConfig JSONB NULL`
- `diag_log_uploads`: `id`, `childDeviceId` (FK cascade), `childId` (FK cascade), `reason`,
  `trigger`, `commandId`, `appVersion`, `sizeBytes`, `snapshot`, `log`, `logcat` (TEXT),
  `createdAt`; индексы `(childId, createdAt DESC)`, `(childDeviceId, createdAt DESC)`.
- `DeviceCommandType` + `UPLOAD_DIAG`.

## Реализация на телефоне

- `PeriscopApplication` (свой Application вместо `android.app.Application`) — обработчик
  необработанных исключений и отправка `crash` на старте любого процесса.
- logcat снимается без `--pid` (`logcat -d -v threadtime -t 5000`): приложению и так видны только
  записи своего UID, а записи предыдущего процесса (падение, запуск после обновления) — самое ценное.
- `DiagLog` маскирует `token=…` (URL аудио-WS содержит токен).

## Проверка (2026-09-29, эмулятор Android 16 + локальный стек)

Подтверждена причина сбоя «Звука вокруг» у части детей: после самообновления
(`MY_PACKAGE_REPLACED`) prewarm службы микрофона падает с
`SecurityException: Starting FGS with type microphone` (запрет старта FGS с микрофоном из фона),
а следующий `START_AUDIO` — тем же исключением в `handleStream`; служба уничтожается, родитель ждёт
впустую до первого ручного открытия приложения ребёнком. Оба сбоя журнал отправил сам
(`audio_prewarm_failed`, `audio_start_failed`).
