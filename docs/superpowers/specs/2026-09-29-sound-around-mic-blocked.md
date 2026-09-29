# «Звук вокруг» после перезагрузки: микрофон заблокирован (v0.62.0)

## Проблема (подтверждено журналами телефонов, 2026-09-29)

Android 14+ (targetSdk 34) не даёт запустить foreground-службу типа `microphone` из фона.
После перезагрузки `BootReceiver` (и после самообновления — `MY_PACKAGE_REPLACED`) запускает
`SoundAroundService` в режиме `prewarm` → `startForeground` бросает `SecurityException`
(«app must be in the eligible state/exemptions to access the foreground only permission»).
Без prewarm `START_AUDIO` из фона падает так же. Работает только после того, как ребёнок
откроет приложение (`MainActivity.onCreate` → prewarm из видимой активности). Сбой не
доходит до сервера: родитель ждёт 45 с и видит «устройство не ответило».

Обойти запрет без действия пользователя нельзя (full-screen intent на Android 14 доступен
только звонкам/будильникам). Решение — сделать нужное действие ребёнка минимальным
(одно касание уведомления) и сделать состояние видимым родителю (урок #10).

## Телефон ребёнка (Kotlin)

- **Готовность микрофона** `micReady` = служба в prewarm/stream foreground-состоянии.
  Хранится статически в `SoundAroundService` + в SharedPreferences (`commit()`).
  Меняется: prewarm OK → true; prewarm FAILED → false; `onDestroy` без stop-команды → false.
- **Уведомление «микрофон заблокирован»**: при prewarm FAILED и stream FAILED —
  канал `periscop_mic_blocked` («Перископ — нужно действие», IMPORTANCE_DEFAULT, без звука),
  заголовок «Перископ», текст «Нажми, чтобы Перископ снова работал полностью».
  Тап → `PendingIntent.getActivity` на новую прозрачную `MicWakeActivity`
  (Theme.Translucent.NoTitleBar, `excludeFromRecents`, `noHistory`, `taskAffinity=""`):
  в `onResume` запускает prewarm через `startForegroundService` и сразу `finish()`.
  При prewarm OK уведомление снимается.
- **Сбой START_AUDIO → сервер сразу**: в `handleStream` при `startForeground` FAILED —
  нативный `POST /child/audio/sessions/:id/error` `{code:"MIC_BLOCKED", message}` с
  device-токеном (как `DiagUpload`), в фоне, без повторов сверх 1 ретрая.
- **Статус на сервер**: в realtime-кадре `hello` добавить `micReady: boolean`; при каждой
  смене — кадр `{op:"status", micReady: boolean}` (если WS подключён; иначе уйдёт в
  следующем `hello`).
- **Журнал (DiagLog/снимок)**: причина запуска `BootReceiver` (action), `micReady`
  переходы с причиной, показ/снятие/тап уведомления, `onDestroy` службы с текущим
  режимом; в `DiagSnapshot` — `micReady`, время последней смены, показано ли уведомление,
  `areNotificationsEnabled` канала `periscop_mic_blocked`.

## Сервер

- `AudioFailureReason` + `MIC_BLOCKED` (миграция `ALTER TYPE ... ADD VALUE`).
- `POST /child/audio/sessions/:id/error` принимает `MIC_BLOCKED`.
- `ChildDevice.micReady Boolean?` + `micReadyAt DateTime?` (null — неизвестно, старое
  приложение). Пишутся из realtime `hello.micReady` и `op:"status"`.
- `GET /family/children` → `device.micReady: boolean | null`.

## Родитель (web; mobile-parent показывает ту же embed-страницу)

- `failReasonLabel(MIC_BLOCKED)`: «Телефон ребёнка не дал включить микрофон — так бывает
  после перезагрузки. На телефоне ребёнка появилось уведомление «Перископ»: пусть нажмёт
  на него, затем попробуйте снова.»
- В диалоге «Звук вокруг» до старта, если `device.micReady === false`: предупреждение
  «Микрофон на телефоне ребёнка выключен (после перезагрузки или обновления). Попросите
  ребёнка нажать на уведомление «Перископ» или открыть приложение.» Кнопка старта остаётся
  доступной (статус мог устареть).
- Embed-страница `/embed/audio/[childId]` получает `micReady` тем же способом, что и данные
  ребёнка сейчас.

## Не делаем

- Автоматический обход запрета (невозможно без взаимодействия пользователя).
- Отдельный heartbeat-endpoint — статус идёт по существующему realtime-каналу.
