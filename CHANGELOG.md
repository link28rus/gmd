# Changelog

Все значимые изменения проекта GMD фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

Страница «Что нового» в web-кабинете рендерится из этого файла.

---

## v0.45.0 — 2026-04-29 — Приложение родителя для Android + карты на OpenStreetMap

### Новые возможности

- **Мобильное приложение родителя для Android (mobile-parent).** До сих пор родитель управлял ребёнком только через web-кабинет. Теперь есть Flutter-приложение: вход по email + пароль, список детей с last-known локацией, экран ребёнка с интерактивной картой, треком за день и списком геозон. Сборка живёт в `apps/mobile-parent`, использует общий backend, FCM-уведомления, secure-storage для access/refresh токенов. iOS появится позже — пока Android (#4886fc3).
- **Тёмная тема для карт в кабинете.** Раньше карта оставалась светлой даже когда весь интерфейс переключался в Dim/Dark — глаз ночью «выжигало». Теперь плитки автоматически следуют ThemeProvider: light → стандартный OSM, dim/dark → CartoDB Dark Matter. Переключение мгновенное, без перезагрузки карты.

### Улучшения

- **Карты переехали с Яндекс.Карт на OpenStreetMap.** И в mobile-parent, и в web-кабинете (`/cabinet`, `/cabinet/zones`). Причина — санкционные риски Yandex SDK, требование API-ключа и зависимость от ToS. OSM работает «из коробки», без ключей и квот, тайлы кэшируются стандартным leaflet'ом. Геокодер (поиск адреса в форме зоны) пока остался на Yandex — переедем отдельно.
- **Сессия в кабинете переживает перезагрузку страницы.** Раньше после F5 родителя выбрасывало на `/login`, потому что auth-state жил только в памяти. Добавлен `zustand/persist` с localStorage — токены восстанавливаются до первого рендера, и пользователь остаётся внутри кабинета.

### Изменения

- **`apps/mobile-parent`** — новые модули: `core/api` (Dio + interceptors + auto-refresh), `core/auth` (login/register/refresh + secure-storage), `core/storage` (SecureStorageService), `features/auth` (login/register screens), `features/children` (repository + providers), `features/child_detail` (карта + трек + зоны), `features/home` (список детей), `features/splash` (auth-gate), `router/app_router.dart` (go_router). Полный список зависимостей в `pubspec.yaml`.
- **Web карты** — `child-map-inner.tsx`, `latest-marker.tsx`, `track-polyline.tsx`, `zones-map-inner.tsx`, `zone-editor-map-inner.tsx` переписаны с `ymap3-components` на `react-leaflet@5`. Конфиг тайлов вынесен в `lib/maps/tile-config.ts` — единый источник light/dim/dark URL и атрибуции.
- **Удалены** `ymap3-components` из `apps/web/package.json` и `NEXT_PUBLIC_YANDEX_MAPS_API_KEY` из `.env.example`. Геокодер ходит через серверный `/api/geocode` с отдельным `YANDEX_GEOCODER_API_KEY`.
- **`apps/web/lib/auth-store.ts`** — обёрнут в `persist` middleware с partialize, чтобы в storage уезжали только поля сессии (без транзитного state).
- **`apps/web/app/globals.css`** — добавлен `.leaflet-dark` фильтр и подкрутка под dim-тему.

---

## v0.44.1+6069 — 2026-04-28 — Фикс: дубликат сигнала «Найди телефон» после нажатия «Остановить»

### Исправления

- **Сигнал перестал проигрываться повторно после остановки.** Раньше через ~90 секунд после того, как ребёнок нажимал «Остановить» в notification, алярм запускался ещё раз. Причина: в v0.43.0 при добавлении FCM-доставки `PLAY_SIGNAL` мы стартовали `SignalSoundService` сразу, но **не делали ack** на бэкенд. Команда висела в БД `pending` 5 минут, и следующий poll-цикл (привязан к 90-секундному location-heartbeat) забирал её и проигрывал ещё раз. Теперь `MyFirebaseMessagingService.handlePlaySignal` сразу после `startForegroundService` отправляет ack `POST /child/commands/{commandId}/ack` в фоновом thread'е — команда становится executed, дубликат исключён.

### Изменения

- **`AppControlHttp.postCommandAck(ctx, commandId)`** — новый public helper, использует существующий `doPost` (auth через X-Child-Token из NativeCreds). Ack идемпотентен: повторный вызов на executed-команде — no-op (см. `DeviceCommandsService.ackCommand` на бэкенде).
- **`MyFirebaseMessagingService.handlePlaySignal`** — после `startForegroundService` запускает Thread с `AppControlHttp.postCommandAck`. Не блокирует main thread (FirebaseMessagingService.onMessageReceived имеет ~10с до ANR).
- Build mobile-child 6068 → 6069.

---

## v0.44.0+6068 — 2026-04-28 — Auto-update mobile-child работает без открытия приложения

### Улучшения

- **Авто-обновление теперь приходит даже если ребёнок не открывает приложение.** Раньше проверка обновлений жила в `update_banner.dart` и срабатывала только при build'е home-экрана. На телефонах детей после initial setup UI открывают месяцами раз — process крутился в FGS-трекинге, а версия зависала. На POCO C75 / TECNO KL4 фиксировали 0.41.1 при актуальной 0.43.0. Теперь native-Kotlin `UpdateCheckWorker` через WorkManager раз в 6 часов сам ходит в `/api/public/updates/mobile-child/latest`, скачивает APK в тот же `externalCacheDir/updates/`, и показывает high-importance notification «Обновление готово к установке». Тап → MainActivity → `UpdateController` подхватывает уже скачанный APK → installer.

### Изменения

- **`UpdateCheckWorker.kt`** — `CoroutineWorker` на чистом HttpURLConnection: GET endpoint, парсинг JSON, скачивание (64KB chunks, 15-мин read timeout под APK ~30МБ на 3G), нотификация. Сравнение версий — по `versionCode` (Flutter Gradle plugin ставит `versionCodeOverride = ABI_VERSION[abi]*1000+pubspecBuild`, бэкенд возвращает то же число → простое целочисленное сравнение).
- **`UpdateCheckScheduler.kt`** — PeriodicWorkRequest 6h с `NetworkType.CONNECTED`, `KEEP`-policy. `runNow()` для one-time трига при открытии MainActivity.
- **Хуки `schedule()`** в трёх точках — `MainActivity.onCreate` + `runNow()`, `BootReceiver`, `LocationForegroundService.onCreate`. Все идемпотентны.
- **Notification channel `gmd_update_channel`** (IMPORTANCE_HIGH, badge). Action «Установить» через FileProvider — пропускает Flutter UI если REQUEST_INSTALL_PACKAGES уже granted.
- Build mobile-child 6067 → 6068.

---

## v0.43.0+6067 — 2026-04-28 — «Найди телефон»: мгновенный сигнал через FCM + бундлованный звонкий звук

### Улучшения

- **Сигнал «Найди телефон» прилетает за 1–3 секунды вместо 60–120.** Раньше, когда родитель нажимал «Сигнал», команда `PLAY_SIGNAL` ставилась только в очередь `DeviceCommand`, а телефон ребёнка забирал её при следующем poll'е (привязан к 2-минутному location-heartbeat). Теперь backend параллельно с очередью шлёт FCM high-priority data-message — `MyFirebaseMessagingService` ловит его в Doze-bypass-режиме и сразу стартует `SignalSoundService`. Если push не доехал (offline >60с TTL / нет fcmToken) — fallback на старую очередь, пользователь не теряет сигнал.
- **Звук сигнала теперь бундлован в APK и максимально пронзительный.** Раньше использовался системный default-alarm — у разных пользователей разной громкости и тембра, на дешёвых OEM мог быть тихим. Теперь играем `res/raw/signal_alarm.wav` — alarm-pattern из чередующихся квадратных волн на 2500 / 3500 Hz по 250 мс (психоакустический пик чувствительности уха), 4 секунды, looped. Параллельно сохраняются: STREAM_ALARM на максимум, обход Silent/DND, вибрация, кнопка «Остановить».

### Изменения

- **`DeviceCommandsService.sendSignal`** — инжектит `FcmService`, после `prisma.deviceCommand.create` вызывает `fcm.sendDataMessage(deviceId, fcmToken, {type: "PLAY_SIGNAL", commandId})`. Дублирующий клик в TTL-окне тоже толкает push — на случай, если первый не доехал из-за оффлайна.
- **`DeviceCommandsModule`** — импортирует `FcmModule`.
- **`MyFirebaseMessagingService.onMessageReceived`** — case `PLAY_SIGNAL` → `startForegroundService(SignalSoundService.ACTION_PLAY)`.
- **`SignalSoundService.startSignal`** — приоритет `MediaPlayer.setDataSource(Uri.parse("android.resource://$packageName/${R.raw.signal_alarm}"))`. Fallback на `RingtoneManager` оставлен (теоретически недостижим).
- **`scripts/gen-signal-sound.mjs`** — генератор WAV (16-bit PCM, 44100 Hz, mono, ~345 KB). Запуск: `node scripts/gen-signal-sound.mjs`.
- Build number mobile-child: 6066 → 6067.

---

## v0.42.0 — 2026-04-28 — Геозоны: быстрое создание двойным кликом, фикс редактирования, переключатель видимости

### Новые возможности

- **Создание зоны двойным кликом по карте.** На странице «Геозоны» теперь не нужно открывать диалог и потом тащить точку — достаточно дважды кликнуть по нужному дому или участку на основной карте, и сразу откроется форма с уже выставленным центром. Дальше остаётся только проверить радиус и дать имя.
- **Клик по карте в редакторе перемещает центр зоны.** Раньше для смены центра приходилось тащить маркер — теперь кликнули по карте, центр прыгнул, круг перерисовался. Маркер для перетаскивания и ручка справа для радиуса остались на месте.
- **Слайдер радиуса в форме зоны** — двигаешь, кружок на карте сразу меняется (50–2000 м, шаг 10 м). Альтернатива перетаскиванию белой точки на восточной границе.
- **Переключатель «Показывать геозоны на карте»** в шапке страницы. Когда зон становится много и они мешают разглядывать сами здания при выборе нового места — отключаем все полигоны одним тапом, выбираем место двойным кликом, и обратно.

### Исправления

- **Редактирование зоны при втором открытии**. Раньше при последовательном открытии формы для разных зон в полях ввода и на карте оставались данные предыдущей зоны (`useState(initial?…)` срабатывает только при первом монтировании компонента). Форма вынесена в отдельный `ZoneEditorForm` с `key={initial.id ?? 'new:lat:lon'}` — при каждой смене режима/зоны/центра React пересоздаёт состояние с нуля.

### Изменения

- **`ZonesMapInner`** — добавлены props `showZones` (default `true`) и `onMapDblClick(lat, lon)`. Двойной клик детектится через `YMapListener.onClick` с порогом 400 мс.
- **`ZoneEditorMapInner`** — добавлен `YMapListener.onClick` → `onCenterChange(lat, lon)`.
- **`ZonesClient`** — `pendingCenter` state для quick-create, `showZones` toggle.

---

## v0.41.1+6066 — 2026-04-28 — Отсев Wi-Fi/network outlier-точек на треке

### Исправления

- **На карте больше не висят отдельные точки в стороне от трека.** Анализ продакшен-данных (Артём, 25 точек за 30 минут) показал паттерн: FusedLocationProvider иногда отдаёт координаты через Wi-Fi MLS (Google positioning) вместо GPS. Такие точки получают «уверенно низкую» accuracy (10-30м), но физически смещены на 30-100 метров — внутри домов, посреди двора, через дорогу. Все формальные accuracy-фильтры (mobile 75м / backend 100м / web 50м) их пропускали. Сигнатура network-fix: **`hasSpeed()=false`** (у настоящего GPS-fix speed заполнен всегда, даже 0). Добавлены два фильтра:
  - **`ACCURACY_GATE_NO_SPEED_M = 10м`** в `LocationForegroundService.sendToDart` — точки без speed с accuracy >10м дропаются. Heartbeat исключён (его speed=NULL легитимный — `lastLocation` cached).
  - **Re-validation в `requestFreshLocationOnce`** (wake-on-motion) — если первая точка после пробуждения не имеет speed или accuracy >30м, дропаем и ждём настоящий FLP-callback (~5 сек). Лучше показать «прыжок» позже, чем кривую координату сразу.

### Изменения

- **`sendToDart`** — расширен лог: добавлены `hasSpeed`, `provider` для диагностики на других OEM.
- Backend и web фильтры **не изменились** (остаются safety-net для старых APK <v0.31.0).

---

## v0.41.0+6065 — 2026-04-28 — Микрофон обязателен на установке + проверка при каждом запуске

### Улучшения

- **Если ребёнок отказался от микрофона — теперь это видно сразу.** Раньше при отказе в системном диалоге onboarding молча пропускал шаг дальше; в кабинете родителя «Звук вокруг» вечно висел на «Устанавливаем соединение» (Android запрещает FGS-microphone без RECORD_AUDIO). Теперь:
  - **В onboarding** микрофон-step не пропускается автоматически: при отказе показывается понятное предупреждение и кнопка «Разрешить» переспрашивает диалог. Кнопка «Пропустить» переименована в «Я не разрешу» — открывает confirmation-диалог с явным предупреждением о последствиях.
  - **При каждом запуске app** новый невидимый `MicrophonePermissionGuard` проверяет статус. Если разрешение отозвано (например, родитель снял в Settings) — показывается модальный диалог «Микрофон выключен» с кнопками «Разрешить» / «Позже». Lifecycle resume тоже триггерит проверку.
  - **Permission Health Banner** на home-экране теперь подсвечивает «Микрофон» рядом с другими critical permissions (location, battery, accessibility). Тап ведёт прямо в `/permissions/microphone` для повторной попытки grant'а.

### Изменения

- **`PermissionHealthBanner._check`** — добавлена проверка `Permission.microphone.status`.
- **`MicrophoneStep`** перевиден из `StatelessWidget` в `StatefulWidget` с `WidgetsBindingObserver` — после возврата из системных Settings (`openAppSettings()`) lifecycle resume перепроверяет статус и автоматически переходит дальше при granted.
- **`MicrophonePermissionGuard`** — новый невидимый widget на home-экране (`SizedBox.shrink`), всё через side-effects: showDialog при mount + lifecycle resume.
- **«Пропустить»** в `MicrophoneStep` теперь требует confirmation через `AlertDialog` с предупреждением «Если не разрешишь — родители не смогут удалённо проверить звук».

---

## v0.40.3+6064 — 2026-04-28 — Wake-on-motion: первая точка трека через 2-3 секунды

### Улучшения

- **Реакция на старт движения сократилась с 60 секунд до 2-3 секунд.** В STILL-профиле раньше первая точка нового трека приходила только когда сработает FLP-апдейт (до 60 сек по `STILL_INTERVAL_MS`) или Activity Recognition (30-90 сек). На длинных стоянках в начале каждой поездки терялись 100-200 метров. Теперь подписываемся на hardware **motion sensor** (`TYPE_MOTION_DETECT` API 24+ или `TYPE_SIGNIFICANT_MOTION` API 18+) — sensor работает в чипе телефона, расход батареи ~0%, срабатывает за 1-3 секунды с момента старта движения. После trigger'а: forced switch ACTIVE + немедленный запрос `fused.getCurrentLocation` (HIGH_ACCURACY, fresh GPS-fix).

### Изменения

- **`MotionSensorMonitor.kt`** — новый Kotlin класс. Выбирает лучший доступный sensor (`MOTION_DETECT` приоритетнее), graceful fallback на `SIGNIFICANT_MOTION`. Если оба недоступны (старые/нестандартные устройства) — `isSupported=false`, остальная логика (speed-based switch + AR) работает как в v0.40.2.
- **`LocationForegroundService.switchProfile`** регистрирует sensor при входе в STILL и снимает при входе в ACTIVE. В ACTIVE он не нужен — FLP и так шлёт обновления каждые 5 сек.
- **`onMotionSensorTriggered`**: обновляет `lastMovingTimeMs` (debounce ACTIVE→STILL), переключает в ACTIVE, дёргает `requestFreshLocationOnce`.
- **`requestFreshLocationOnce`** — новый метод, использует `fused.getCurrentLocation(PRIORITY_HIGH_ACCURACY)` чтобы получить свежую GPS-точку за 1-3 сек, не дожидаясь следующего FLP-cycle.
- **DiagLog** при старте сервиса логирует `motion sensor support: MOTION_DETECT(30) / SIGNIFICANT_MOTION(17) / NOT_SUPPORTED` — для проверки на разных устройствах. Подтверждено на POCO C71 (UNISOC, бюджет) и Xiaomi 12T Pro (Snapdragon 8+ Gen 1) — оба поддерживают.

---

## v0.40.2+6063 — 2026-04-28 — Активный режим держится 15 минут после остановки

### Улучшения

- **Трек больше не «рвётся» на коротких остановках.** В v0.40.1 переключение в STILL делалось через 90 секунд неподвижности — после светофора, остановки автобуса или захода в магазин на 5 минут устройство уходило в экономичный режим, а следующий перегон начинался с разреженных точек (пока speed не вырос обратно до 7 км/ч). Теперь debounce поднят до **15 минут**: светофор, пробка, магазин — остаёмся в ACTIVE-режиме с плотным треком. Только реальная длительная стоянка (дом, школа на уроках, парковка ≥15 мин) переключает в STILL.

### Изменения

- **`STILL_DEBOUNCE_MS`** в `LocationForegroundService.kt`: `90_000L` → `15 * 60_000L`. Никаких других изменений в логике.

### Трейд-офф

- Расход батареи на сценарии «активный день с короткими остановками» (прогулка по парку 30 мин с остановками на качелях) вырастет на ~1-2%/час — но именно это и даёт UX «как у Где мои дети»: трек читаемый, не разорванный.

---

## v0.40.1+6062 — 2026-04-28 — Плотный трек по дорогам (fix экономичного режима)

### Исправления

- **Трек теперь идёт по дорогам, а не пунктирной прямой через посёлки.** В v0.31 ввели экономичный профиль (STILL: интервал 5 минут, дистанция 50 м), переключение Active↔Still делалось ТОЛЬКО через Activity Recognition Google Play Services — у которого latency 30-90 секунд. На практике: ребёнок сел в машину, AR ещё думает что STILL, точки приходят раз в 5 минут (= 5 км пропуска на 60 км/ч), Yandex Maps рисует прямую через посёлки между двумя удалёнными точками. Теперь переключение профилей работает мгновенно по `Location.speed` из самих обновлений FLP — STILL→ACTIVE на следующей точке если speed ≥ 7 км/ч, ACTIVE→STILL после 90 сек низкой скорости (debounce от светофоров).

### Изменения

- **ACTIVE-профиль уплотнён:** 5 сек / 10 м, `PRIORITY_HIGH_ACCURACY` (было 10 сек / 20 м, BALANCED). На скорости 50 км/ч точки идут через ~10-15 м, форма дороги читается. Расход батареи в этом профиле выше, но ребёнок в нём только пока движется.
- **STILL-профиль смягчён:** 60 сек / 30 м (было 5 мин / 50 м). Heartbeat 90 сек (было 2 мин). Когда телефон лежит дома — почти не тратит батарею, но если ребёнок начал двигаться, мы заметим за 60 сек, а не за 5 минут.
- **`maybeAutoSwitchProfile(loc)`** — новый метод в `LocationForegroundService`. Вызывается из `sendToDart` ДО фильтров (даже если accuracy gate отбросит точку, факт «speed = 15 м/с» всё равно даёт нам switch). Activity Recognition остался как fallback (если permission ACTIVITY_RECOGNITION не дан).

---

## v0.40.0+6061 — 2026-04-28 — Auto-update mobile-child из приложения

### Новые возможности

- **Автоматическое обновление приложения ребёнка.** Раньше для обновления mobile-child нужно было вручную скачать APK с web-кабинета и переустановить — родитель часто не имеет физического доступа к телефону ребёнка. Теперь приложение проверяет наличие новой версии при каждом запуске. Если есть — сразу скачивает APK в фоне (видна полоса прогресса с процентами и размером), по готовности автоматически открывает системный диалог установки. Кнопки «Установить» / «Повторить» позволяют управлять процессом если что-то пошло не так. Если разрешения на установку из приложения нет — показывается баннер «Открыть настройки» который ведёт прямо в нужный экран Settings.
- **Если обновлений нет — баннер не показывается.** UI остаётся чистым для всех актуальных версий.

### Изменения

- **Web (Next.js):** новый публичный endpoint `GET /api/public/updates/mobile-child/latest?abi=arm64-v8a`. Парсит APK из `/srv/download` через существующий `listDownloadFiles()`, сортирует по SemVer + Flutter buildNumber, возвращает топ. 204 если для ABI нет APK, 400 при невалидном ABI. Caddyfile получил отдельный handle для `/api/public/updates/*` → web.
- **Web utility:** `lib/downloads/version-compare.ts` — парсер X.Y.Z[-prerelease][+build] и compare-функция. Stable > prerelease, build (Flutter versionCode) — tie-breaker.
- **Native (Kotlin):** `InstallerNative` — singleton с `canRequestInstall()` (API 26+ → `PackageManager.canRequestPackageInstalls`, ниже — true), `openInstallSourceSettings()` (`Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` с `package:<our>`), `installApk(path)` (FileProvider URI + ACTION_VIEW + APK MIME).
- **Manifest:** `<uses-permission REQUEST_INSTALL_PACKAGES>` + `<provider androidx.core.content.FileProvider>` с authority `${applicationId}.fileprovider`. Path `external-cache-path/updates/` (см. `res/xml/file_provider_paths.xml`).
- **Channel `ru.link28rus.gmd.child/installer`** — методы `canRequestInstall` / `openInstallSourceSettings` / `installApk` / `cleanupCache`.
- **Dart `core/updates/`:**
  - `UpdateInfo` + `ParsedVersion` (compare X.Y.Z + prerelease + build).
  - `UpdatesService` — `checkLatest()` + `downloadApk()` через Dio (15-min receive timeout для медленного 3G).
  - `UpdateController` (Riverpod StateNotifier) — sealed state `UpdateIdle/Checking/NotNeeded/Downloading/Downloaded/InstallerLaunched/NeedsPermission/Failed`. Auto-trigger installer один раз чтобы не зацикливать диалог.
- **`UpdateBanner`** на `home_screen.dart` — рендерит state в карточку с прогрессом и кнопками. При `Idle/Checking/NotNeeded/InstallerLaunched` — `SizedBox.shrink` (UI чист).
- **Lifecycle resume** баннер перепроверяет `canRequestInstall` — если user только что разрешил установку в settings, автоматически дёрнет installer.
- **Защита от install-loop:** per-filename флаг `update_installer_attempted_<filename>` в encryptedSharedPreferences. Auto-trigger срабатывает ОДИН раз — если пользователь отменил системный диалог, на следующем запуске app покажет UpdateBanner с кнопкой «Установить» вместо повторного auto-launch (раздражало бы каждый старт). При обновлении до новой версии флаг для предыдущей удаляется через `cleanupCache` (вызывается на UpdateNotNeeded). Endpoint нормализует `buildNumber` под Flutter ABI offset (`ABI_VERSION * 1000 + pubspecBuild`) — иначе `PackageInfo.buildNumber` (8060 для arm64+`+6060`) не совпадает с raw `+6060` из имени файла, и сравнение версий ломается.

---

## v0.39.6 — 2026-04-27 — Fix: launcher и системные UI больше не блокируются

### Исправления

- **Overlay блокировки больше не появляется на home screen / launcher / системных UI.** В v0.39.5 при активной блокировке оверлей появлялся не только на запрещённом приложении, но и на launcher'е (`com.miui.home` и аналоги), системном поиске (`com.mi.appfinder`), MIUI SystemUI плагинах. Ребёнок не мог закрыть overlay чтобы попасть на home screen и пользоваться разрешёнными приложениями — каждый клик по «Закрыть» возвращал на home, где a11y тут же снова показывал overlay (бесконечный цикл).
- **Кнопка «Закрыть» теперь реально закрывает overlay.** Решение: динамически детектируем все установленные launcher'ы через `PackageManager.queryIntentActivities(Intent.ACTION_MAIN+CATEGORY_HOME)` — это покрывает MIUI, OneUI (Samsung), Pixel Launcher, Nova и любые сторонние lauchers'ы. Расширили `SAFETY_ALLOWED` для MIUI/HyperOS системных пакетов (`com.miui.systemui.plugin`, `miui.systemui.plugin`, `com.miui.securitycenter`, `com.mi.appfinder` и др.) + generic Android (`android`, `com.google.android.permissioncontroller`).

### Изменения

- **`BlockManager.SAFETY_ALLOWED`** расширен: ~10 новых системных packages для MIUI/HyperOS + generic Android.
- **`BlockManager.getLauncherPackages(ctx)`** — новая функция, кэширует результат `PackageManager.queryIntentActivities(HOME)`. Cache инвалидируется при `setRules` (на случай если ребёнок поставил новый launcher между sync'ами).
- **`BlockManager.isBlocked` / `getEffectiveMode`** теперь дополнительно проверяют `getLauncherPackages` — все установленные launcher'ы whitelisted, вне зависимости от OEM.
- **Логика после клика «Закрыть»** не изменилась — но теперь работает корректно благодаря whitelist'у launcher'а.

---

## v0.39.5 — 2026-04-27 — Visual blocking overlay через WindowManager (Phase 6.2 финал)

В v0.39.4 блокировка работала функционально (HOME action выкидывал на launcher),
но визуальный экран «🔒 Телефон заблокирован» не показывался — Android 12+
блокировал запуск Activity из background. v0.39.5 решает это через
`SYSTEM_ALERT_WINDOW` + `WindowManager.addView` (этот window layer не подпадает
под BAL ограничения).

### Новые возможности

- **Полноценный visual overlay при блокировке.** Когда ребёнок открывает запрещённое приложение, поверх любого экрана появляется чёрный фон с большим 🔒, текстом «Телефон заблокирован», live-таймером «ещё X мин Y сек» и синей кнопкой «Закрыть» (отправляет на launcher). Visually идентично «Где мои дети». Реализовано через `TYPE_APPLICATION_OVERLAY` window — не Activity, поэтому BAL restriction не блокирует.
- **Onboarding-шаг «Экран блокировки».** Идёт после шага Accessibility. Открывает Settings → Спецдоступ → «Поверх других приложений» → ребёнок включает тумблер. Lifecycle resume ловит grant. Без grant'а блокировка работает (HOME action), но без визуального экрана — пользователь может skip.
- **Permission Health Banner показывает «Поверх других приложений»** если SAW не grant'ed. Переход прямо на onboarding-шаг.

### Изменения

- **Native (Kotlin):** новый singleton `OverlayManager` управляет жизненным циклом overlay через `WindowManager.addView`/`removeView` с `TYPE_APPLICATION_OVERLAY`. Использует тот же XML layout `activity_block_overlay.xml`. Countdown timer в Handler, expire → авто-hide. Кнопка «Закрыть» → `ACTION_MAIN+CATEGORY_HOME` (HOME-intent имеет специальный BAL exemption).
- **`GmdAccessibilityService`** теперь делает `OverlayManager.show` (visual) + `performGlobalAction(GLOBAL_ACTION_HOME)` (надёжный kick) — первое требует SAW, второе работает всегда. На устройстве с SAW — overlay поверх launcher'а; без SAW — пользователь просто на launcher (graceful degradation).
- **`BlockManager.clearActiveBlock`** автоматически вызывает `OverlayManager.hide` — при FCM `UNBLOCK_APPS` overlay убирается мгновенно.
- **`AppControlNative`:** добавлены `canDrawOverlays()` и `openOverlaySettings()` (open `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` с `package:<our>`).
- **Dart:** `AppControlChannel.canDrawOverlays()` / `openOverlaySettings()`.
- **Wizard:** новый `OverlayStep` widget (`lib/features/permissions/overlay_step.dart`), маршрут `/permissions/overlay`. Переход `accessibility_step._goNext` теперь → `/permissions/overlay` (вместо `/home`). Все existing steps обновлены `totalSteps: 8 → 9`.
- **Permission Health Banner:** проверяет `canDrawOverlays`, при выключенном — добавляет «Поверх других приложений» в `_missing` и роутит на `/permissions/overlay`.
- `BlockOverlayActivity` остался в коде но больше не используется (запасной путь). Удалится в v0.40.

---

## v0.39.4 — 2026-04-27 — Fix блокировки на HyperOS / Android 12+ (background-activity-start)

### Исправления

- **Блокировка приложений теперь реально работает на HyperOS / Android 12+ (mobile-child).** Раньше AccessibilityService корректно детектировал попытку открыть запрещённое приложение, но `startActivity(BlockOverlayActivity)` системой обрывался с `ActivityTaskManager: Abort background activity starts` (Android 12+ запрещает запуск Activity из background даже из AccessibilityService процесса). На обычных Android (Pixel, Samsung One UI) overlay показывался, на Xiaomi/HyperOS — нет, приложение продолжало работать. Теперь a11y делает **двухступенчатый ответ**: 1) `performGlobalAction(GLOBAL_ACTION_HOME)` мгновенно (~50 мс) выкидывает на launcher (это system-action, не требует exemption); 2) `startActivity(BlockOverlayActivity)` сверху launcher'а — если показалась, ребёнок видит привычный «🔒 Телефон заблокирован», если HyperOS BAL абортит — graceful degradation, ребёнок уже на home. В любом случае запрещённое приложение исчезает с экрана.
- **`SYSTEM_ALERT_WINDOW` permission объявлен в манифесте.** Это special access (грантится через системные настройки, не runtime). Когда родитель его выдаст в onboarding — overlay будет показываться с гарантией даже без HOME-trampoline'а (TYPE_APPLICATION_OVERLAY layer). UI для grant'а появится в следующей версии.

---

## v0.39.3 — 2026-04-27 — Honest подпись о скорости применения правил

### Исправления

- **Подпись «Применяется на устройстве ≤15 мин» вводила в заблуждение.** Изменено на «Применяется на устройстве за несколько секунд» с тултипом-уточнением «через FCM high-priority push (≈5 сек). Если устройство офлайн — догонит через ≤15 мин при следующем поллинге». Код уже работал быстро — backend шлёт FCM `SYNC_RULES`/`BLOCK_APPS`/`UNBLOCK_APPS` с `priority: 'high'`, `ttl: 60s` через тот же `sendDataMessage`, что и «Звук вокруг». Поллинг 15 мин — fallback на случай отвалившегося FCM, не нормальный сценарий.

---

## v0.39.2 — 2026-04-27 — Один список приложений вместо двух

UX-уборка на странице «Родительский контроль»: убрали дублирующий раздел
«Все приложения», вся информация теперь в одной секции «Приложения».

### Изменения

- **Раздел «Все приложения» удалён.** Раньше было два почти одинаковых списка: «Все приложения» (только просмотр + статистика) и «Правила приложений» (тогда же управление). Это создавало визуальную перегруженность — один и тот же список приложений появлялся дважды на одной странице. Сегодняшнее время использования теперь отображается прямо в подписи каждой строки в едином списке.
- **Раздел переименован: «Правила приложений» → «Приложения».** Один список — одно название.
- **Подсказка «нет данных» переехала в новый раздел.** Если устройство ещё не прислало installed-apps (нужны 15 минут после grant Usage Stats / интернет / правильное разрешение), баннер с подсказкой показывается сверху раздела «Приложения», но HARDCODED-правила (наш child-app, MAX) всё равно отображаются ниже — родитель сразу видит, что точно работает.

---

## v0.39.1 — 2026-04-27 — Поиск приложений + 3-state правила

Развитие UI «Родительский контроль»: родителю теперь удобнее искать конкретное
приложение в длинном списке и явно отмечать «всегда заблокировано» (а не только
«разрешено всегда» как было в v0.39.0).

### Новые возможности

- **Поиск приложений.** В разделе «Правила приложений» сверху появилось поле поиска. Фильтрует по названию и package name (case-insensitive), мгновенно — без запроса на сервер.
- **3-state контрол вместо тумблера.** Раньше для каждого app был только тумблер «Не блокируется» (вкл/выкл). Теперь — 3 кнопки: ✓ «Разрешено всегда», — «По умолчанию», ⛔ «Заблокировано всегда». Третий режим (ALWAYS_BLOCKED) поддерживался backend и устройством с v0.39.0 — но в UI его не было видно. Теперь TikTok / запрещённый сайт можно заблокировать постоянно, без необходимости запускать блок-сессию.
- **Фильтр-табы.** Над списком — Все / Разрешённые / По умолчанию / Заблокированные с количеством в каждой категории. Удобно посмотреть «что я уже настроил».
- **Сортировка по приоритету.** Сверху — HARDCODED (наш child app + MAX), затем ALWAYS_BLOCKED (что родитель явно запретил), потом ALWAYS_ALLOWED (whitelist), потом DEFAULT отсортированные по сегодняшней активности.

### Изменения

- Раздел переименован: «Не блокируется» → **«Правила приложений»**, чтобы охватывать оба сценария.
- Hardcoded apps (наш + MAX) — segmented control disabled, всегда в позиции ✓ «Разрешено».
- Подзаголовки apps стали информативнее: добавлено сегодняшнее время использования, если оно есть («Соцсети · 23 мин»).
- Toast'ы при изменении правил — только при ошибке (успех — визуальный feedback на segmented control).

---

## v0.39.0 — 2026-04-27 — Phase 6.2 «Блокировка приложений» 🔒

Полноценный релиз функции блокировки приложений: родитель из веб-кабинета может
заблокировать все приложения на устройстве ребёнка на 5 мин..24 ч, кроме
звонков, SMS, камеры и явного whitelist'а.

### Новые возможности

- **Блокировка приложений по таймеру.** На странице «Родительский контроль» появилась кнопка «Заблокировать приложения» — открывает диалог с пресетами 5 мин / 15 мин / 30 мин / 1 ч / 2 ч / 4 ч / 8 ч / 24 ч. После подтверждения на устройстве ребёнка через FCM или поллинг (≤15 мин) активируется глобальная блокировка: при попытке открыть запрещённое приложение появляется полноэкранный оверлей «🔒 Телефон заблокирован» с countdown'ом «осталось X мин Y сек» и кнопкой «Закрыть». Интерсепция через AccessibilityService (event `TYPE_WINDOW_STATE_CHANGED`), оверлей через отдельную lock-screen-bypass Activity.
- **Карточка активной блокировки в кабинете.** Сверху страницы «Родительский контроль» родитель видит «Приложения заблокированы» с локальным временем окончания и live-countdown'ом (тик каждую секунду) + кнопкой «Снять блок». Опрос состояния — раз в 30 сек, сессия истекает автоматически на стороне backend (`pg_cron` каждую минуту) и синхронно подхватывается устройством.
- **Whitelist «Не блокируется».** Раздел внизу страницы — toggle-list для каждого установленного app: HARDCODED (наш child-app, мессенджер MAX — всегда включены, нельзя выключить), SYSTEM_DEFAULT (звонки, SMS, камера — авто-разрешённые) и любые приложения по выбору родителя. Whitelist применяется на устройстве ребёнка немедленно через FCM `SYNC_RULES`, fallback — поллинг `GET /child/app-rules` каждые 15 мин.
- **Onboarding-шаг «Блокировка приложений» (mobile-child).** Открывается после шага «Статистика приложений», ведёт на системный экран Спецвозможностей и обнаруживает успешный grant через lifecycle resume. На Xiaomi/HyperOS дополнительно отдельная кнопка «Разрешить ограниченные настройки» открывает карточку приложения для bypass'а MIUI restricted-settings.
- **Индикатор статуса блокировки на главном экране (mobile-child).** Если AccessibilityService выключен — в красном Permission Health Banner появляется пункт «Блокировка приложений», tap ведёт сразу на onboarding-шаг.

### Изменения

- **Backend:** новый модуль `AppBlockingService` — модель «whitelist + глобальный таймер» (а не «blacklist + per-app»). HARDCODED-приоритет: `HARDCODED_ALLOWED = ['ru.link28rus.gmd.child', 'ru.oneme.app']` зашит в коде и нельзя переопределить через `PARENT`/`SYSTEM_DEFAULT`. pg_cron job `gmd_block_sessions_auto_expire` (`* * * * *`) переводит просроченные сессии в EXPIRED. `OnModuleInit` cleanup на старте бэкенда. FCM data-messages типа `BLOCK_APPS` / `UNBLOCK_APPS` / `SYNC_RULES`.
- **Mobile-child:** Kotlin singleton `BlockManager` (SharedPreferences для активной сессии и rules), `BlockOverlayActivity` (full-screen, `setShowWhenLocked(true)`, swallow-back, FLAG_KEEP_SCREEN_ON), `GmdAccessibilityService` (throttle 500ms/package, никогда не падает). Periodic `BlockPollWorker` (15 мин) + manual trigger при старте app. Интеграция с `ChildEscapeOrchestrator` — при reclaim'е активная блокировка снимается локально.
- **Web-parent:** новые TanStack Query hooks `useActiveBlock`/`useAppRules`/`useCreateBlock`/`useStopBlock`/`useUpsertAppRule`. Mutations через `setQueryData`/`invalidateQueries` для мгновенного UI без ожидания poll. Imageнтрировано в существующую страницу `/cabinet/children/[id]/parental-control`.

### Известные ограничения

- **HyperOS / MIUI «Ограниченные настройки».** На Xiaomi-устройствах включить AccessibilityService через ADB (`pm grant WRITE_SECURE_SETTINGS`, `settings put secure enabled_accessibility_services`) невозможно — система фильтрует sideload-сервисы из bound-services. Onboarding-шаг ведёт пользователя на правильный экран, но ручное действие («Разрешить ограниченные настройки» → тумблер) обязательно. Это не баг GMD — то же ограничение действует для конкурентов («Где мои дети» и др.).
- **`am force-stop` сбрасывает grant.** На HyperOS принудительное завершение приложения иногда удаляет его из `enabled_accessibility_services`. Если родитель пользуется «Очистить память» — нужно повторно включить тумблер. Будет исправлено в v0.40 через периодическую проверку статуса и push-уведомление родителю.
- **Whitelist не имеет optimistic UI.** Toggle меняет статус только после ответа backend (≤200 ms). При лаговой сети пользователь увидит небольшую задержку. Будет улучшено по запросу.

### E2E verification

Phase 6.2 проверена end-to-end на 12T Pro (HyperOS V816, Android 15):
- Backend INSERT BlockSession → poll get-active → BlockManager `setActiveBlock` ✓
- AccessibilityService bound, `onAccessibilityEvent` fires for blocked package ✓
- `BlockOverlayActivity` шапка «🔒 Телефон заблокирован», countdown «ещё 4 мин 30 сек», кнопка «Закрыть» ✓
- Whitelist (наш child app) открывается без интерсепции ✓
- Auto-expire ровно в `endsAt` (overlay-tick-expired event на устройстве + EXPIRED state в БД) ✓

---

## v0.39.0-rc.5 — 2026-04-27 — Phase 6.2 «Блокировка приложений» (web-parent UI)

Завершает первый рабочий end-to-end флоу для App Blocking: backend (rc.1) +
mobile-child (rc.2/rc.3) + web-parent UI (rc.5). Родитель теперь видит и
управляет активной блокировкой из веб-кабинета.

### Новые возможности

- **Кнопка «Заблокировать приложения» на странице «Родительский контроль».** Открывает диалог time-picker с пресетами 5 мин / 15 мин / 30 мин / 1 ч / 2 ч / 4 ч / 8 ч / 24 ч (backend принимает `durationMin: 5..1440`). По подтверждению создаёт `BlockSession` через `POST /family/children/:id/app-control/block-sessions`, FCM `BLOCK_APPS` уходит на устройство ребёнка немедленно.
- **Карточка активной блокировки сверху страницы.** Показывает live-countdown «осталось X ч Y мин» (тикает каждую секунду на клиенте) + локальное время окончания. Кнопка «Снять блок» → `DELETE /block-sessions/:id` (FCM `UNBLOCK_APPS`). Опрос `GET /block-sessions/active` — раз в 30 сек, чтобы UI автоматически обновился если сессия истекла или была снята с другого устройства.
- **Раздел «Не блокируется» с whitelist-toggle для каждого приложения.** Список объединяет HARDCODED (наш child-app, MAX — тумблер всегда включён, disabled), SYSTEM_DEFAULT (звонки, SMS, камера — авто-разрешённые backend'ом), PARENT-исключения (родительский whitelist) и все installed-apps. Клик по тумблеру → `PUT /app-rules/:packageName` с `mode: ALWAYS_ALLOWED` или `DEFAULT`, FCM `SYNC_RULES` доставляется ребёнку, `BlockPollWorker` подтягивает изменения за ≤15 мин на случай отказа FCM.

### Изменения

- **API client (`lib/api/app-control.ts`):** добавлены типы `AppRuleMode`, `AppRuleSource`, `AppRuleDto`, `BlockSessionDto`, константа `HARDCODED_ALLOWED_PACKAGES = ['ru.link28rus.gmd.child', 'ru.oneme.app']`. Методы `createBlockSession`, `activeBlockSession`, `stopBlockSession`, `listAppRules`, `putAppRule`.
- **TanStack Query hooks (`lib/hooks/use-app-control.ts`):** `useActiveBlock` (refetchInterval 30s, staleTime 0), `useAppRules`, `useCreateBlock`, `useStopBlock`, `useUpsertAppRule`. Mutations используют `setQueryData`/`invalidateQueries` чтобы UI обновлялся мгновенно без ожидания poll.
- **Next API proxy:** добавлены `/api/children/[id]/app-control/block-sessions` (POST), `/block-sessions/active` (GET), `/block-sessions/[sessionId]` (DELETE), `/app-rules` (GET), `/app-rules/[packageName]` (PUT). `lib/backend.ts` и `_helpers.ts` расширены поддержкой PUT.
- **`BlockDialog` компонент (`components/children/block-dialog.tsx`):** изолированный диалог с пресет-чипами, обработкой `409 session_already_active` / `404 no_active_device`. Reset state на закрытии.
- **Страница `/cabinet/children/[id]/parental-control`:** старый `DisabledBlockButton` (заглушка из v0.38) заменён на рабочий `BlockButton` (скрывается при активной блокировке). Добавлены `ActiveBlockCard` и `WhitelistSection`. Имя ребёнка для UI берётся из `useChildren()` — без отдельного fetch.

---

## v0.39.0-rc.4 — 2026-04-27

### Исправления

- **fix(web): кнопка «Родительский контроль» в боковой панели карты.** На карточке ребёнка на странице `/cabinet/children/[id]/map` (и в любом контексте, где используется компонент `ChildActions`) кнопка отсутствовала — `ShieldCheck` ссылка была только в карточках на главной `/cabinet`. Теперь пункт меню «Родительский контроль» показывается между «История передвижений» и «Защита от удаления» при привязанном устройстве.

---

## v0.39.0-rc.3 — 2026-04-26 — onboarding-шаг для блокировки приложений (mobile-child)

В rc.2 устройство умело показывать блокировочный оверлей, но включить
AccessibilityService приходилось вручную через системные настройки. rc.3
добавляет полноценный wizard-шаг и индикатор статуса на главном экране.

### Новые возможности

- **Шаг «Блокировка приложений» в onboarding-wizard.** Открывается после шага «Статистика приложений», ведёт пользователя на системный экран Спецвозможностей и обнаруживает успешный grant через lifecycle resume. Включает отдельную кнопку «Разрешить ограниченные настройки (Xiaomi)» — открывает карточку приложения в Settings, пользователь нажимает ⋮ → «Разрешить ограниченные настройки», после чего тумблер Accessibility активируется. Без этого шага на MIUI/HyperOS Accessibility просто не включается.
- **Индикатор статуса блокировки в Permission Health Banner на /home.** Если AccessibilityService выключен — в красном баннере появляется пункт «Блокировка приложений», tap ведёт сразу на новый шаг wizard. Старые установленные пользователи (онбординг был пройден до v0.39) увидят это автоматически.

### Изменения

- **Native (Kotlin):** добавлены `AppControlNative.isAccessibilityServiceEnabled()`, `openAccessibilitySettings()`, `openAppDetailsSettings()`. Регистрация в `MainActivity` MethodChannel `app_control`. Все three методы безопасно throw'ют через `result.error('open_settings_failed', ...)` при недоступности Settings activity.
- **Dart channel:** `AppControlChannel.isAccessibilityServiceEnabled()`, `openAccessibilitySettings()`, `openAppDetailsSettings()`.
- **Wizard:** новый `AccessibilityStep` widget (`lib/features/permissions/accessibility_step.dart`), маршрут `/permissions/accessibility`. Переход `usage_stats_step` → `/home` заменён на `/permissions/accessibility`. Все existing steps (`notifications`, `location`, `battery`, `activity`, `microphone`, `usage-stats`) обновлены `totalSteps: 6 → 8`.
- **Permission health banner:** проверяет `isAccessibilityServiceEnabled()`, при выключенном — добавляет «Блокировка приложений» в `_missing` и роутит на `/permissions/accessibility`.

---

## v0.39.0-rc.2 — 2026-04-26 — Phase 6.2 «Блокировка приложений» (mobile-child)

Реализует устройственную часть Phase 6.2: устройство ребёнка теперь умеет
ловить попытки открыть запрещённое приложение и показывать full-screen
блокировочный экран с countdown'ом до конца сессии.

### Новые возможности

- **Блокировочный оверлей на устройстве ребёнка.** Когда родитель запускает блок-сессию из бэкенда (rc.1), устройство мгновенно (через FCM `BLOCK_APPS`) или с задержкой ≤15 мин (через `BlockPollWorker`) сохраняет активную сессию локально. Каждое переключение foreground app проверяется через `AccessibilityService` — если package в blacklist, поверх него запускается `BlockOverlayActivity`: full-screen, lock-screen bypass, FLAG_KEEP_SCREEN_ON, swallow back-button, кнопка «Закрыть» → Home.

### Изменения

- **AccessibilityService реактивирован.** Класс был no-op с v0.29.2 (PIN-lock убран). Теперь снова в манифесте + `accessibility_service_config.xml` (только `typeWindowStateChanged`, без чтения content). Для уже установленных в RuStore версий: пользователь должен вручную включить через Settings → Accessibility → «Где мои дети — ребёнок» (wizard в onboarding добавим в rc.3 при появлении UI).
- **`BlockManager` (Kotlin singleton, SharedPreferences-backed).** Хранит активную сессию (sessionId+endsAt) и whitelist правила (JSON). API `isBlocked(pkg)` для AccessibilityService с приоритетом HARDCODED → SAFETY_ALLOWED → AppRule → Mode.DEFAULT-with-active-session. Локально продублирован HARDCODED whitelist (`ru.link28rus.gmd.child`, `ru.oneme.app`) и SAFETY_ALLOWED (Settings, dialer, telecom, emergency) — даже без backend ответа критичные системные apps не блокируются.
- **`BlockOverlayActivity` (XML layout, без Compose).** Показывает таймер вида «ещё 1 ч 59 мин» с тиком раз в секунду. При истечении endsAt сам вызывает `clearActiveBlock` + Home. На onPause закрывается (если ребёнок ушёл) — следующий blocked-window AccessibilityService поднимет overlay снова.
- **`BlockPollWorker` (15 мин periodic).** Fallback poll `GET /child/active-block` + `GET /child/app-rules`. Страховка от потерянного FCM push'а (TTL 60с) или Doze. Также one-time запускается в `MainActivity.onCreate` для immediate sync при открытии app.
- **FCM handlers.** `MyFirebaseMessagingService` теперь обрабатывает `BLOCK_APPS{sessionId, endsAt}`, `UNBLOCK_APPS{sessionId}`, `SYNC_RULES`. ISO-парсинг endsAt через SimpleDateFormat (формат фиксирован backend'ом). На SYNC_RULES делает background pull `GET /child/app-rules`.
- **`AppControlHttp`.** Добавлены `getActiveBlock()` и `getAppRules()`, общий `doGet()` с теми же таймаутами и логированием.
- **Escape hatch расширен.** `ChildEscapeOrchestrator.triggerEscape()` дополнительно вызывает `BlockManager.clearActiveBlock()` — без этого если родитель удалит ребёнка во время активной блокировки, AccessibilityService продолжит блокировать запуск apps (повисает устройство).

### Известные ограничения

- **Onboarding wizard для AccessibilityService** будет в rc.3 (вместе с web-parent UI). Пока пользователь должен включить вручную через Settings → Accessibility.
- **Web-parent UI** — диалог time picker, sub-tab «Не блокируется» — rc.3.
- **Mobile-parent native** — отдельной фазой.
- **MIUI/HyperOS «Ограниченные настройки»** — на новых OEM Android требует «Разрешить ограниченные настройки» для AccessibilityService после sideload-установки. Wizard добавим в rc.3.

---

## v0.39.0-rc.1 — 2026-04-26 — Phase 6.2 «Блокировка приложений» (backend core)

Первый rc нового Phase 6.2 «App Blocking Core». Backend-only релиз — child и
parent UI пока не подключены, проверка через curl/тесты.

### Новые возможности

- **Backend для блокировки приложений у ребёнка по запросу родителя.** Реализована модель «whitelist + глобальный таймер»: родитель запускает блок-сессию длительностью 5 мин..24 ч, на устройстве ребёнка всё блокируется кроме явного whitelist'а (mode `ALWAYS_ALLOWED`), системных defaults (default dialer/sms/camera/contacts/settings — резолвит сам ребёнок) и зашитых в backend `ru.link28rus.gmd.child` + `ru.oneme.app`. Запасной вариант — `ALWAYS_BLOCKED` для постоянно запрещённых приложений (UI в v0.40).

### Изменения

- **Prisma:** новые модели `AppRule` (per-(child × packageName)) и `BlockSession` (per-child максимум одна `ACTIVE`); enums `AppRuleMode {DEFAULT|ALWAYS_ALLOWED|ALWAYS_BLOCKED}`, `AppRuleSource {PARENT|SYSTEM_DEFAULT|HARDCODED}`, `BlockSessionState {ACTIVE|ENDED|EXPIRED}`, `BlockEndReason {PARENT_STOPPED|EXPIRED|UNLOCK_APPROVED}`; миграция `20260426170000_phase6_app_blocking_core` с pg_cron job `gmd_block_sessions_auto_expire` (раз в минуту переводит просроченные сессии в `EXPIRED`).
- **Backend endpoints (parent, JWT):**
  - `POST /family/children/:id/app-control/block-sessions` — создать сессию `{durationMin}`. 409 если уже есть `ACTIVE`.
  - `GET /family/children/:id/app-control/block-sessions/active` — текущая активная сессия (auto-expire on-read).
  - `DELETE /family/children/:id/app-control/block-sessions/:sessionId` — досрочное завершение, идемпотентно.
  - `GET /family/children/:id/app-control/app-rules` — список правил `PARENT + SYSTEM_DEFAULT`.
  - `PUT /family/children/:id/app-control/app-rules/:packageName` — установить правило, source автоматически `PARENT`.
- **Backend endpoints (child, device-token):**
  - `GET /child/app-rules` — effective whitelist (`HARDCODED` + `PARENT` + `SYSTEM_DEFAULT`); HARDCODED идут первыми и не перезаписываются.
  - `GET /child/active-block` — активная блок-сессия для устройства (или `{session: null}`).
- **FCM команды:** `BLOCK_APPS{sessionId, endsAt}` при создании, `UNBLOCK_APPS{sessionId}` при остановке, `SYNC_RULES` при изменении правила. Fire-and-forget; при недоставке child подтягивает через poll-эндпоинты.
- **OnModuleInit cleanup:** при старте бэка все `ACTIVE` сессии с истёкшим `endsAt` помечаются `EXPIRED` (страховка от gap'а между shutdown и pg_cron tick).
- **Тесты:** `app-blocking.service.spec.ts` — 16 unit-тестов, покрывают create/stop/getActive/upsertRule/listEffective/onModuleInit, включая идемпотентность и приоритет HARDCODED.

### Известные ограничения

- **Mobile-child** ещё не использует новые endpoints — Drift таблицы, `BlockManager`, FCM handlers, AccessibilityService extension и `BlockOverlayActivity` будут в `v0.39.0-rc.2`.
- **Web-parent** UI (диалог time picker, sub-tab «Не блокируется», список правил) — `v0.39.0-rc.3`.
- **Mobile-parent** native — отдельной фазой после развития base app.

---

## v0.38.1 — 2026-04-26

### Исправления

- **fix(web): чарт «Минут по часам» снова виден.** Активные часы теперь рендерятся ярко-синими (`bg-blue-500` без 70%-opacity, минимум 6% высоты), пустые часы — тонкой серой линией базы. До фикса столбцы с реальной активностью были почти неотличимы от пустых из-за низкой контрастности на dark theme.

---

## v0.38.0 — 2026-04-26 — «Родительский контроль» (статистика экранного времени)

Phase 6.1 «Родительский контроль» в стабильном релизе. Объединяет работу rc.1..rc.7.

### Новые возможности

- **Статистика экранного времени ребёнка в web-кабинете родителя.** На карточке ребёнка → кнопка «Родительский контроль» открывает страницу `/cabinet/children/[id]/parental-control` с тремя вкладками (Вчера / Сегодня / Неделя), большой цифрой общего времени, графиком по часам, чипами по категориям (Соцсети / Игры / Мессенджеры / Видео / Браузеры / Образование / Музыка / Навигация / Покупки / Системные / Другое) и списком всех установленных у ребёнка приложений с реальными иконками, временем за сегодня и принадлежностью к категории.
- **Автоматический сбор данных на устройстве ребёнка.** На стороне `mobile-child` поднимается WorkManager с тремя periodic-задачами: UsageStats каждые 15 минут, список установленных приложений + иконки раз в сутки, escape-probe раз в час. Иконки 96x96 PNG дедуплицируются по SHA-256 (одна и та же иконка TikTok у тысячи семей хранится в БД один раз). Каждый запуск приложения дополнительно дёргает one-time worker — родитель видит свежие данные через 30 секунд.
- **Onboarding-шаг** для PACKAGE_USAGE_STATS permission с инструкцией для MIUI/HyperOS «Ограниченные настройки».
- **Escape hatch — самоуничтожение защиты при удалении ребёнка.** Если родитель удалит ребёнка из кабинета (или сделает «Сбросить устройство»), `mobile-child` в течение часа (или сразу при следующем 401-ответе на любом endpoint) дёргает `POST /child/auth-status`, видит `child_deleted` / `device_revoked` и автоматически: снимает Device Admin, останавливает все workers, стирает device-token, переходит на специальный экран «Родитель удалил твой профиль» с кнопкой «Открыть настройки приложения» для нормального uninstall. Без этого защищённое v0.27 Device Admin превращало бы устройство в «кирпич». **Verified end-to-end на 12T Pro link28rus.**

### Изменения

- **Backend:** новые модели `installed_apps`, `app_icons` (BYTEA dedupe по sha256), `usage_buckets` (часовые), `child_devices.timezone`. Endpoints `/child/installed-apps`, `/child/app-icons`, `/child/usage-reports`, `/child/auth-status`, `/family/children/:id/app-control/installed-apps`, `/family/children/:id/app-control/usage`, `/app-icons/:sha256` (immutable cache 1 год). pg_cron retention 30 дней для `usage_buckets`. Express body-parser limit 10MB. CategoryResolver на 11 категорий × 200+ packages.
- **Mobile-child:** Kotlin `AppControlNative` (UsageStatsManager queryEvents → часовые bucket'ы по local-TZ), `AppControlHttp` (HttpURLConnection для worker'ов), `UsageStatsReportWorker` / `InstalledAppsReportWorker` / `EscapeProbeWorker`, `AppControlScheduler`, `ChildEscapeOrchestrator`. Manifest: `PACKAGE_USAGE_STATS` + `QUERY_ALL_PACKAGES`. Dart обёртки + `EscapeScreen` + main.dart auto-redirect.
- **Web-parent:** Next.js API proxy routes, `lib/api/app-control.ts`, TanStack Query hooks `useInstalledApps` / `useUsage`, страница `/cabinet/children/[id]/parental-control` с pure-CSS bar chart (24/7 столбиков), кнопка `ShieldCheck` «Родительский контроль» в `ChildCard` (только при активном устройстве).

### Verified на проде

- 12T Pro link28rus (Xiaomi 22081212UG, Android 15 HyperOS V816) — 524 установленных apps, 280 уникальных иконок в БД, escape hatch отработал безупречно.
- TECNO KL4 Степан (Android 14, HiOS) — APK rc.7 успешно установлен.
- Скриншот web-кабинета: страница «Родительский контроль» рендерится корректно с реальными иконками (2ГИС, Авито, ВТБ, Бристоль, Галерея и т.д.) и правильной категоризацией.

### Известные ограничения

- **Время в приложениях / график / чипы категорий** показывают пустое состояние пока ребёнок вручную не включит `PACKAGE_USAGE_STATS` (Settings → Apps → GMD → Special permissions → Usage data → Allow). Wizard в onboarding появляется только при первом запуске приложения; для существующих установок permission нужно дать руками.
- **Mobile-parent** native экран «Родительский контроль» — пока не реализован (mobile-parent проект сейчас boilerplate без auth-flow). Будет в отдельной фазе как часть полноценного развития mobile-parent.
- **Блокировка приложений** (BlockSession + AppRule) — отдельный релиз v0.39 (App Blocking Core) согласно дизайн-доку.

### Что в следующих релизах

- **v0.39** — App blocking. Кнопка «Заблокировать приложения» с time picker и whitelist «Не блокируется».
- **v0.40** — Unlock requests («Мне очень нужно»), `ALWAYS_BLOCKED` mode.
- **v0.41+** — гео-привязка блокировок, mobile-parent native UI.

---

## v0.38.0-rc.7 — 2026-04-26

### Улучшения

- **mobile-child: при каждом запуске app сразу триггерим `runInstalledAppsNow` + `runUsageNow`** (one-time WorkManager job), не дожидаясь периодического тика. Решает проблему когда после серии 5xx-ошибок periodic worker уходит в exponential backoff на 24+ часа — после fix backend родитель должен видеть данные в кабинете в течение минуты, а не на следующий день. Verified на 12T Pro link28rus: после первой ошибки (PayloadTooLarge) periodic ушёл в backoff +23h51m → после rc.7 install через 30 секунд **280 иконок и 524 apps в БД**.

---

## v0.38.0-rc.6 — 2026-04-26

### Исправления

- **fix(backend): payloadtoolarge на `/child/app-icons` 500 → 200.** Дефолтный Express body-parser лимит 100KB не пропускал батчи иконок (50 PNG × ~30KB base64 = до 7MB). Поднят до 10MB через `app.use(json({ limit: '10mb' }))`. Также распространяется на `/child/usage-reports` (до 24000 bucket'ов) и `/child/installed-apps` (до 1000 apps). Без этого фикса rc.5 mobile-child не мог залить иконки → web-кабинет родителя видел бы appLabel без иконок.

---

## v0.38.0-rc.5 — 2026-04-26

### Новые возможности

- **Escape hatch для удалённого ребёнка.** Если родитель удалит ребёнка из кабинета (или сделает «Сбросить устройство»), mobile-child устройство **автоматически снимет защиту Device Admin и блокировки** (когда они появятся в v0.39), очистит креденшиалы и покажет специальный экран — приложение можно нормально удалить через Настройки. Без этого защищённый Device Admin превратил бы телефон в «кирпич». Реакция: в течение 1 часа (periodic probe) или сразу при следующем запуске app/worker'а с 401-ответом.

### Изменения

- **Backend:** `POST /child/auth-status` (без auth-guard, throttle 6/мин). Возвращает явный статус токена: `active` / `device_revoked` / `child_deleted` / `unknown`. Mobile-child использует чтобы понять — нужно ли self-destruct, или это просто временная сетевая проблема.
- **Mobile-child Kotlin `ChildEscapeOrchestrator`:**
  - `probe(ctx)` — POST на backend и при `device_revoked` / `child_deleted` автоматически вызывает `triggerEscape`.
  - `triggerEscape(reason)` — `dpm.removeActiveAdmin()` + `NativeCreds.setProtectionEnabled(false)` + `WorkManager.cancelAllWork()` + `NativeCreds.save(null,null)` + флаг в SharedPreferences `gmd_escape.escape_mode = true`. Идемпотентно.
  - Sphlвает Network errors (NETWORK_ERROR не триггерит escape — иначе любой обрыв сети сносит защиту).
- **Mobile-child Kotlin `EscapeProbeWorker`** — `CoroutineWorker` periodic 1h. Зарегистрирован в `AppControlScheduler.scheduleAll` рядом с usage/installed-apps worker'ами.
- **Hook 401:** при auth-error от `UsageStatsReportWorker` или `InstalledAppsReportWorker` → немедленный probe (не ждём периодического часа).
- **MainActivity:** при `onCreate` (если есть token) — фоновый probe + scheduleAll(escape).
- **Channel `ru.link28rus.gmd.child/escape`:** `isInEscapeMode`, `lastReason`, `probeNow`, `openAppDetails`.
- **Dart `EscapeChannel`** + `EscapeScreen`** (`/escape` route): иконка lock-open + объяснение причины (`child_deleted` / `device_revoked`) + кнопки «Открыть настройки приложения» (для uninstall) и «Проверить связь».
- **`main.dart`** — auto-redirect на `/escape` если `EscapeChannel.isInEscapeMode()` при старте.
- **mobile-child build:** versionCode +47 → +48 (для RuStore monotonic versionCode).

### Что осталось для v0.38

- **rc.6 mobile-parent UI:** «Родительский контроль» на Flutter (тот же что web rc.4).
- **Smoke end-to-end:** install rc.5 на 12T Pro (link28rus) → пройти onboarding → grant usage stats → проверить sync с backend → удалить ребёнка из кабинета → проверить что устройство уходит в escape mode и Device Admin снимается.

---

## v0.38.0-rc.4 — 2026-04-26

### Новые возможности

- **Web-кабинет: страница «Родительский контроль»** на карточке ребёнка → кнопка «Родительский контроль» → `/cabinet/children/[id]/parental-control`. Табы Сегодня / Вчера / Неделя, бар-чарт по часам (в режиме недели — по дням), большая цифра общего времени с индикатором «↑/↓ % от обычного» (для «Сегодня»), чипы по категориям (Соцсети / Игры / Мессенджеры / …), список установленных приложений с иконками + временем за сегодня + категорией + меткой «системное». Кнопка «Заблокировать приложения» — заглушка, появится в v0.39 после бэкенд-моделей BlockSession.

### Изменения

- **Next.js API proxy routes** под рестанонные endpoints rc.1:
  - `GET /api/children/[id]/app-control/installed-apps`
  - `GET /api/children/[id]/app-control/usage?range=day|week&date=YYYY-MM-DD`
  - `GET /api/app-icons/[sha256]` — public proxy (immutable cache 1 год, single origin для браузера) к backend `AppIconsPublicController`.
- **Lib `lib/api/app-control.ts`** — TypeScript типы (`AppCategory`, `InstalledAppDto`, `UsageRangeDto`, `UsageResponseDto`), `appControlApi` методы. Helper `rewriteIconUrl()` подменяет URL backend'а на `/api/app-icons/<sha256>` (избегает CORS dev/prod).
- **Lib `lib/hooks/use-app-control.ts`** — TanStack Query hooks `useInstalledApps(childId)`, `useUsage(childId, range, date?)` с `staleTime: 5 мин`.
- **Component `ChildCard`** — добавлена кнопка `ShieldCheck` «Родительский контроль» (видна только при активном устройстве).
- **EmptyAppsHint** — UI-подсказка с тремя возможными причинами пустого списка (нет permission, прошло <15 мин с включения, нет интернета).

### Что осталось для v0.38

- **rc.5 mobile-parent:** тот же экран на Flutter (fl_chart) — следующий заход.
- **Smoke-тест end-to-end:** установить APK rc.3 на устройство, грантить permission, дождаться ≥15 мин или вручную дёрнуть worker, открыть страницу в кабинете и убедиться что данные приходят.

---

## v0.38.0-rc.3 — 2026-04-26

### Изменения

- **mobile-child Phase 6.1: WorkManager periodic workers + onboarding wizard.**
  - **Kotlin `AppControlHttp.kt`** — `HttpURLConnection`-клиент для нативных worker'ов: `postInstalledApps` / `postAppIcons` / `postUsageReport`. Читает `deviceToken` + `apiBaseUrl` из `NativeCreds` SharedPreferences. Без новых зависимостей. Возвращает `Result(ok, statusCode, bodyJson)` для классификации worker'ом.
  - **Kotlin `UsageStatsReportWorker`** (15-min `CoroutineWorker` periodic): дёргает `AppControlNative.collectUsageBuckets(daysBack)` + `AppControlHttp.postUsageReport`. **Первый запуск — backfill 7 дней** (флаг в SharedPreferences `gmd_app_control`); последующие — 1 день. 4xx → `success-skip`, 5xx/network → `retry` с exp backoff.
  - **Kotlin `InstalledAppsReportWorker`** (24h periodic): `collectInstalledApps` → `postInstalledApps` (получает `missingIconSha256`) → батчами ≤50 `postAppIcons`. Constraint `BATTERY_NOT_LOW` (PNG-кодирование).
  - **Kotlin `AppControlScheduler`** — `enqueueUniquePeriodicWork(KEEP)` для обоих worker'ов. Helpers `runUsageNow` / `runInstalledAppsNow` для one-time trigger (используются wizard'ом сразу после grant'а).
  - **MainActivity** — `scheduleAll()` в `onCreate` (если есть token) и в `saveNativeCreds` handler'е (после claim'а).
  - **Dart `core/native/app_control_channel.dart`** — добавлены `scheduleAll()`, `runUsageNow()`, `runInstalledAppsNow()`.
  - **Dart `features/permissions/usage_stats_step.dart`** — onboarding шаг «Доступ к статистике приложений». Открывает `Settings.ACTION_USAGE_ACCESS_SETTINGS`, при resume lifecycle проверяет grant и запускает worker'ы. MIUI/HyperOS-инструкция про «Ограниченные настройки» в описании.
  - **Router** — маршрут `/permissions/usage-stats`, devadmin placeholder теперь ведёт на usage-stats вместо `/home`.
- **build.gradle.kts** — `androidx.work:work-runtime-ktx:2.9.1` (для periodic workers).

### Что осталось для v0.38

- **v0.38.0-rc.4 (web-parent):** страница `/children/[id]/parental-control` — табы Сегодня/Вчера/Неделя, bar chart, чипы категорий, список apps с иконками.
- **v0.38.0-rc.5 (mobile-parent):** тот же экран на Flutter.
- **Smoke-тест rc.3 на устройстве** — реальный install + grant + наблюдение что workers выполняются + проверка backend-данных.

---

## v0.38.0-rc.2 — 2026-04-26

### Изменения

- **mobile-child Phase 6.1 native-фундамент** (без worker'ов и UI wizard — следующий rc.2b):
  - **Kotlin `AppControlNative.kt`**: `hasUsageStatsPermission()` через `AppOpsManager.unsafeCheckOpNoThrow(OPSTR_GET_USAGE_STATS)`, `openUsageStatsSettings()` (Settings.ACTION_USAGE_ACCESS_SETTINGS), `deviceTimezone()` (IANA), `collectInstalledApps()` (PackageManager + 96x96 PNG icons + sha256), `collectUsageBuckets(daysBack)` (UsageEvents ACTIVITY_RESUMED/PAUSED → часовые bucket'ы в local-TZ, корректно режет интервалы по границам часов).
  - **MethodChannel `ru.link28rus.gmd.child/app_control`** в MainActivity. Тяжёлые операции (`collectInstalledApps`, `collectUsageBuckets`) выполняются на background-thread.
  - **Dart `core/native/app_control_channel.dart`**: type-safe обёртки `AppControlChannel` + DTO `InstalledAppNative` (с `Uint8List iconPngBytes`) и `UsageBucketNative`.
  - **Dart `core/api/child_api.dart`**: новые методы `postInstalledApps` (возвращает list missing iconSha256), `postAppIcons` (батч ≤50, base64), `postUsageReport` (под endpoints rc.1).
  - **Manifest:** `PACKAGE_USAGE_STATS` + `QUERY_ALL_PACKAGES` permissions с `tools:ignore`.

### Что осталось для v0.38.0-rc.2b

- WorkManager periodic workers (`UsageStatsWorker` 15-min, `InstalledAppsWorker` daily) — будут дёргать `AppControlNative` напрямую без MethodChannel.
- UI wizard: экран onboarding для grant `PACKAGE_USAGE_STATS` (по аналогии с a11y wizard v0.27.1, с MIUI/HyperOS-текстом про «Ограниченные настройки»).
- DiagLog индикатор «Usage Stats: granted/denied» на /debug экране.
- 7-day retroactive backfill при первом успешном grant'е.

---

## v0.38.0-rc.1 — 2026-04-26

### Новые возможности

- **Phase 6.1 «Родительский контроль» — backend-фундамент.** Подготовлены модели данных и API для сбора статистики экранного времени с устройств детей и хранения списка установленных приложений с иконками. UI парента (web + mobile) и сборщик на mobile-child пойдут отдельным релизом v0.38.0-rc.2. Дизайн фичи — [docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md](docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md).

### Изменения

- **Prisma migration `20260426160000_phase6_screen_time`**:
  - `child_devices.timezone TEXT?` — IANA timezone устройства ребёнка для агрегации `usage_buckets` по local-date.
  - `installed_apps` — снапшот установленных apps (childDeviceId, packageName, appLabel, iconSha256, isSystem, category, firstSeenAt, lastSeenAt). UNIQUE(childDeviceId, packageName).
  - `app_icons` — глобальный sha256-dedupe кэш PNG-иконок (BYTEA, max 100KB на иконку, content-addressable). На MVP хранится в БД; миграция в MinIO — при росте >10GB.
  - `usage_buckets` — часовые bucket'ы использования (childDeviceId, date, hour, packageName, seconds). UNIQUE(childDeviceId, date, hour, packageName).
  - `pg_cron` job `gmd_usage_buckets_cleanup` (DELETE старше 30 дней, 03:15 UTC). DO/EXCEPTION-обёртка чтобы dev без pg_cron не падал.
- **Backend модуль `apps/backend/src/app-control/`**:
  - `AppControlService` — UPSERT installed apps / icons / usage buckets, агрегации `getUsage(range='day'|'week')` с `byHour[24]`/`byHour[7]`, `byCategory`, `vsAverage` (% разница со средним за 7 дней).
  - `CategoryResolver` — резолв package → category по статичному JSON-справочнику топ-200 RU/EN apps (11 категорий: social, messengers, video, games, browsers, education, music, navigation, shopping, system, other).
  - `AppControlChildController` (auth: device-token):
    - `POST /child/installed-apps` — снапшот установленных apps + timezone, возвращает список missing iconSha256 для последующей загрузки;
    - `POST /child/app-icons` — батч новых иконок (до 50 за раз, base64 PNG ≤100KB, sha256 верифицируется на бэке + PNG magic check);
    - `POST /child/usage-reports` — часовые bucket'ы (UPSERT-replace, max 24000 buckets за payload).
  - `AppControlParentController` (auth: JWT):
    - `GET /family/children/:id/app-control/installed-apps` — список с iconUrl, категорией, временем за сегодня;
    - `GET /family/children/:id/app-control/usage?range=day|week&date=YYYY-MM-DD` — агрегации.
  - `AppIconsPublicController`:
    - `GET /app-icons/:sha256` — public, immutable Cache-Control max-age 1 год, Throttle 600/мин.
- **Throttle limits:** installed-apps 5/час, app-icons 20/час, usage-reports 30/час (под worker'ы 1×day / 15-min с запасом на retry).

### Что в следующих релизах v0.38

- **v0.38.0-rc.2:** mobile-child — UsageStatsWorker (Kotlin, 15-min periodic + 7-day backfill), InstalledAppsWorker (daily + sha256-dedup иконок), wizard для `PACKAGE_USAGE_STATS` permission.
- **v0.38.0-rc.3:** web-parent — страница `/children/[id]/parental-control` (вкладки Сегодня/Вчера/Неделя, bar chart, чипы категорий, список apps).
- **v0.38.0-rc.4:** mobile-parent — тот же экран на Flutter.
- **v0.39:** App blocking (BlockSession, AppRule, BlockOverlayActivity, FCM BLOCK_APPS/UNBLOCK_APPS).

---

## v0.37.0-rc.1 — 2026-04-26

### Новые возможности

- **«Звук вокруг» подключается за 3-10 секунд вместо 60-120.** Backend отправляет команду `START_AUDIO` ребёнку через **FCM high-priority data-message** параллельно с очередью `DeviceCommand` — Firebase будит устройство и доставляет команду без ожидания poll-цикла. То же для `STOP_AUDIO`. **End-to-end verified на Тимохе (Xiaomi 25028PC03G, locked screen): click → стрим за 10 секунд (vs 60-120 сек раньше).** Очередь команд остаётся как fallback: если FCM не настроен, упал, или у устройства нет валидного token — child заберёт команду через poll, как в v0.36.

### Изменения

- **Prisma migration `20260426150000_add_fcm_token`**: `child_devices.fcmToken String?` (UNIQUE) + `fcmTokenUpdatedAt DateTime?`.
- **Backend** `apps/backend/src/fcm/` с `FcmService` (Firebase Admin SDK V1, init из `FIREBASE_SA_KEY` base64-env). Если переменной нет — DISABLED state с warn'ом, fallback на poll работает прозрачно.
- **Backend endpoint `POST /child/devices/fcm-token`** (auth через X-Child-Token) — child регистрирует/обновляет FCM token при старте app и `onTokenRefresh`. Идемпотентен; защищён от race с UNIQUE constraint при FCM token reset.
- **Backend `AudioService.createSession()` / `expireOrFail()` / `endSession()`** — параллельно с очередью вызывают `fcm.sendDataMessage()`. UNREGISTERED/INVALID_ARGUMENT errors → автоматически чистят `fcmToken` в БД.
- **Mobile-child Android `MyFirebaseMessagingService`**: `onMessageReceived` парсит `data.type` (START_AUDIO/STOP_AUDIO) и стартует SoundAroundService. `onNewToken` сохраняет в SharedPreferences для повторной регистрации.
- **Mobile-child Dart `FcmRegistrar`**: на startup при наличии device-token получает FCM token у Firebase и POST'ит на backend. Подписан на `onTokenRefresh` для автоматической перерегистрации при rotate'е.
- **Mobile-child** `firebase_messaging` plugin активирован, `Firebase.initializeApp()` в `main()` (best-effort).
- **Android gradle**: `com.google.gms.google-services:4.4.4` plugin + `firebase-bom:34.12.0` + `firebase-messaging`.
- **Docker compose**: проброс `FIREBASE_SA_KEY` в backend контейнер. Опционально (если не задано — FCM disabled).
- **`.env.prod.example`**: документирована переменная `FIREBASE_SA_KEY` с инструкцией base64-encode.
- **Manifest**: зарегистрирован `MyFirebaseMessagingService` с FCM intent-filter.

### Безопасность

- `service-account.json` хранится в `.firebase-credentials/` (gitignore).
- `google-services.json` в `apps/mobile-child/android/app/` (gitignore через `**/google-services.json`).
- На прод сервере `FIREBASE_SA_KEY` лежит в `/opt/gmd/.env.prod` (только root reading).

---

## v0.36.0-rc.2 — 2026-04-26

### Исправления

- **«Звук вокруг» больше не падает в «не отвечает», когда parent ждёт несколько раз подряд.** Backend теперь дедуплицирует пары `START_AUDIO` + `STOP_AUDIO` для одной `sessionId` в очереди команд ребёнка. Сценарий race: родитель кликает «Звук вокруг» → backend ставит START_AUDIO в очередь → ребёнок не успевает спросить за watchdog timeout → backend ставит STOP_AUDIO для той же сессии. К моменту следующего poll'а (60-120с) в очереди обе команды для уже мёртвой сессии — child запускал Flutter engine на 145мс, тут же глушил, WS не открывал, parent видел «Ошибка соединения». Теперь backend помечает обе команды как expired в `listPending()` и не отдаёт ребёнку — следующий клик parent создаёт чистую сессию без застрявших STOP в очереди ([device-commands.service.ts](apps/backend/src/device-commands/device-commands.service.ts)).
- **`SESSION_IDLE_TIMEOUT_MS` поднят с 90s до 180s** — чтобы PENDING-сессии добивались `expireIfStuck` (без enqueue STOP_AUDIO), а не gateway watchdog'ом (который enqueue'ит STOP). Это вторая страховка против того же race ([audio.gateway.ts](apps/backend/src/audio/audio.gateway.ts)).

### Изменения

- Тесты: добавлен `device-commands.service.spec.ts` с 4 кейсами на дедупликацию START+STOP.

---

## v0.36.0-rc.1 — 2026-04-26

### Новые возможности

- **«Звук вокруг» работает при заблокированном экране ребёнка.** Раньше функция работала только при разблокированном — Android 14 жёстко блокирует `startForeground(type=MICROPHONE)` из background context (locked screen, headless isolate, AlarmManager-trampoline тоже не помогает) с SecurityException «the app must be in the eligible state/exemptions». Решение через D-lite архитектуру: SoundAroundService запускается при открытии приложения (Activity foreground = разрешено) в pre-warm режиме (FGS=microphone idle, без AudioRecord), и остаётся жить. Когда родитель шлёт START_AUDIO — service уже в FGS state, просто включается AudioRecord без нового FGS-старта. Mic-indicator (зелёная точка) появляется только при активном AudioRecord, не от FGS=microphone в idle. mobile-child v0.36.0-rc.1+45.

### Изменения

- Исправлено поведение `SoundAroundService.onTaskRemoved` — теперь свайп приложения из recents НЕ убивает service (раньше убивал, и следующий «Звук вокруг» крашился при locked screen). Service переживает task removal, готов к STREAM команде.
- В `BootReceiver` добавлен best-effort pre-warm SoundAroundService после ребута (если system даёт BootReceiver mic-exemption). При неудаче — юзер откроет app сам, MainActivity.onCreate сделает prewarm.
- `AudioStartTrampolineReceiver` (v0.35.0-rc.7) больше не вызывается — оставлен в коде как dead code, удалим в v0.36.1.

---

## v0.35.0-rc.7 — 2026-04-24 (rolled back)

### Исправления (попытка, не сработала)

- **«Звук вокруг» при заблокированном экране — попытка через AlarmManager-trampoline.** Гипотеза: `AlarmManager.setExactAndAllowWhileIdle()` даёт receiver'у TempAllowList exemption на ~10 сек, в этом окне `startForeground(type=MICROPHONE)` должен пройти. PoC через adb logcat показал что **подход НЕ работает на Android 14**: TempAllowList от AlarmManager даёт exemption на FGS-start, но НЕ на mic-access (это второй check). SecurityException всё равно крашит app. См. v0.36.0-rc.1 для рабочего решения через pre-warm.

---

## v0.35.0-rc.6 — 2026-04-24

### Исправления

- **«Звук вокруг» работает при заблокированном экране.** Раньше FGS стартовал, но `executeDartEntrypoint` зависал на 30-60 сек до разблокировки экрана (на MIUI/HyperOS Binder-вызовы к Flutter loader не обслуживаются без активного wake lock). Добавлен `PARTIAL_WAKE_LOCK` в `SoundAroundService` (по образцу `LocationForegroundService` v0.15.2) — захват микрофона теперь стартует моментально и работает в фоне всю сессию (до 5 минут). mobile-child v0.35.0-rc.6+43.

---

## v0.35.0-rc.5 — 2026-04-24

### Исправления

- **«Звук вокруг» — фикс PERMISSION_DENIED ложного срабатывания на устройстве ребёнка.** `record_android` 6.x в headless isolate (FGS-контекст без Activity) возвращал `hasPermission()=false` даже когда permission реально granted в Android Settings. Убран pre-check, попытка `startStream()` идёт напрямую — Android выкидывает SecurityException только если permission реально отсутствует, ошибка корректно мапится в `PERMISSION_DENIED`. mobile-child v0.35.0-rc.5+42.
- **«Звук вокруг» — родитель видит причину ошибки на устройстве ребёнка.** Backend при `child_error` (PERMISSION_DENIED / MIC_BUSY / OEM_BLOCKED / NETWORK_ERROR) теперь передаёт код в WebSocket close-reason (`child_error:<CODE>`). Web-кабинет парсит и показывает читаемое сообщение вместо общего «Не удалось установить соединение».

---

## v0.35.0-rc.4 — 2026-04-24

### Изменения

- **«Звук вокруг» — Phase 4: cleanup coturn-инфраструктуры.** WebRTC/TURN-relay полностью изъят из стека после переезда на WebSocket-relay в v0.35.0-rc.1..rc.3.
- infra: удалён `coturn` сервис из `docker-compose.dev.yml` и `docker-compose.prod.yml`. Удалена директория `infra/docker/coturn/` (turnserver.conf).
- infra: переменные `TURN_SHARED_SECRET`, `TURN_REALM`, `TURN_PORT`, `TURN_EXTERNAL_IP`, `TURN_PUBLIC_HOST`, `TURN_PUBLIC_PORT` удалены из `infra/docker/.env.dev.example` и `.env.prod.example`. Заменены на `AUDIO_WS_SECRET` и `AUDIO_WS_PUBLIC_URL`.
- infra: `docker-compose.prod.yml` — backend сервис теперь получает `AUDIO_WS_SECRET` и `AUDIO_WS_PUBLIC_URL` env вместо TURN_*.
- infra: добавлен `handle /audio/ws` в `infra/caddy/Caddyfile` для проксирования WebSocket подключений к backend (Caddy v2 автоматически апгрейдит Connection: Upgrade; настроены `read_timeout 0s` и `flush_interval -1` для долгих стримов).
- docs: `docs/deploy.md` раздел «coturn (TURN для Звук вокруг)» полностью переписан под WebSocket-relay. Добавлен runbook для одноразового сноса coturn-инфраструктуры с prod (docker rm + ufw delete + router port-forward removal).
- НЕ ломает существующий dev-стек до тех пор пока локальный `.env.dev` не обновлён: docker-compose уже не пытается поднять coturn.

> ⚠ Этот rc-тег готов к prod-деплою после Phase 5 (Playwright E2E + manual smoke на Xiaomi). Перед деплоем — runbook сноса coturn инфраструктуры в `docs/deploy.md`.

---

## v0.35.0-rc.3 — 2026-04-24

### Изменения

- **«Звук вокруг» — Phase 3: mobile-child Opus-recorder + WebSocket uploader.** Приложение ребёнка переписано под backend-relay из v0.35.0-rc.1. Вместо WebRTC peer connection / TURN-relay-через-чужой-сервер теперь шлём Opus-кадры прямо в backend, который передаёт их родителю по второму WebSocket'у.
- mobile-child: новый `SoundAroundController` (`apps/mobile-child/lib/features/sound_around/sound_around_controller.dart`) — `record.startStream(PCM 16kHz mono)` → накопление в `BytesBuilder` до 20-мс кадра (640 байт) → `SimpleOpusEncoder.encode(Int16List 320)` → `WebSocket.add(opusBytes)`. Auto-stop по `durationSec + 5с`, error reporting через WS control-frame `{op:'error', code, message}` + HTTP-fallback на `/child/audio/sessions/:id/error`.
- mobile-child: `audio_command_handler.dart` понимает новый payload `START_AUDIO`: `{sessionId, ws: {url, token, ttlSec}, durationSec}`. Обработка `AUDIO_ANSWER` удалена (больше не приходит).
- mobile-child: `sound_around_entry.dart` инициализирует `opus_dart` через `opus_flutter.load()` (lazy Future, ждётся в первом `init` коллбеке от native). `applyAnswer` MethodChannel метод удалён.
- mobile-child: `core/api/audio_api.dart` — убраны `sendReady` и `sendIce` (HTTP signaling endpoints удалены backend'ом в Phase 1). Остался `sendError` как fallback.
- mobile-child: добавлены `record ^6.2.0`, `opus_dart ^3.0.1`, `opus_flutter ^3.0.3`, `web_socket_channel ^3.0.3`. Удалён `flutter_webrtc`.
- mobile-child (Android native): `SoundAroundChannel.kt` — `start` принимает `wsUrl` вместо `turnCreds`, метод `deliverAnswer` удалён. `SoundAroundService.kt` — `EXTRA_TURN_CREDS_JSON` → `EXTRA_WS_URL`, `sActiveBgChannel` static reference удалён (был нужен только для пробрасывания `applyAnswer` из UI engine'а в background — теперь не используется).
- mobile-child: pubspec версия `0.35.0-rc.2+40` → `0.35.0-rc.3+41` (versionCode инкрементирован для RuStore).
- mobile-child: 67 unit-тестов passed, `flutter analyze` clean. `audio_api_test.dart` и `audio_command_handler_test.dart` обновлены под новый API. Реальное покрытие WebSocket+Opus pipeline — manual smoke на Xiaomi (Phase 5).

> ⚠ Production-сборка `0.35.0-rc.3` готова к ручному тестированию end-to-end на устройстве, но Phase 4 (cleanup coturn из docker-compose.prod.yml) и Phase 5 (Playwright + Xiaomi smoke) ещё впереди — без них прод не катить.

---

## v0.35.0-rc.2 — 2026-04-24

### Изменения

- **«Звук вокруг» — Phase 2: web parent listener на WebSocket + Opus.** Веб-кабинет родителя переписан под новый WebSocket-relay backend'а из v0.35.0-rc.1. Парент больше не делает SDP/ICE handshake — открывает один WebSocket и слушает поток Opus-кадров.
- web: новый `WebAudioOpusPlayer` (`apps/web/lib/audio/opus-player.ts`). Цепочка `WebSocket(binary=arraybuffer) → opus-decoder (WASM, sampleRate=48kHz mono) → AudioWorkletNode("audio-player") → MediaStreamAudioDestinationNode → MediaStream`. Контракт `useAudioSession.mediaStream: MediaStream | null` сохранён, поэтому `<audio>` element и `createVuMeter` в `AudioListenDialog` не меняются.
- web: `public/audio-player-worklet.js` — простой ring-buffer AudioWorkletProcessor, postMessage Float32Array без SharedArrayBuffer (чтобы не настраивать COOP/COEP заголовки и не ломать сторонние скрипты вроде Yandex Metrika).
- web: переписан `lib/hooks/use-audio-session.ts` — убраны `useAudioSse` и `AudioSessionController`, добавлен mapping WebSocket close-кодов backend'а в UI-стейты (`4006/4002/4003 → expired`, `4008 → ended/expired`, `4401/4404/4400 → failed`).
- web: `lib/api/audio.ts` адаптирован под новый response (`ws: {url, token, ttlSec}` вместо `turnCreds: TurnCreds`); удалены `sendAnswer` и `sendIce`.
- web: добавлен npm-пакет `opus-decoder@^0.7` (Ethan Halsall, prod-tested WASM-декодер, не требует SharedArrayBuffer).
- web: удалены файлы `lib/webrtc/` (audio-session-controller + spec) и `lib/hooks/use-audio-sse.ts` (+spec). `lib/webrtc/vu-meter.ts` перенесён в `lib/audio/vu-meter.ts`.
- web: тесты `lib/api/audio.spec.ts` обновлены под новый API; всего 66/66 web-тестов passed (1 skipped — unrelated zone-editor).
- env: dev-серверу нужен `AUDIO_WS_PUBLIC_URL=ws://localhost:3001/audio/ws` в backend'е (уже выставлен в `apps/backend/.env`).

> ⚠ mobile-child всё ещё на WebRTC — Phase 3 ломает «Звук вокруг» end-to-end до завершения Phase 5. Не катить на prod до v0.35.0.

---

## v0.35.0-rc.1 — 2026-04-24

### Изменения

- **«Звук вокруг» — переход с WebRTC/coturn на WebSocket-relay (Phase 1: backend).** Plan E E2E (v0.34.1–v0.34.6) показал, что WebRTC через TURN не работает в нашей CG-NAT-топологии: оба клиента (parent+child) аллоцируют relay от одного coturn, и `CREATE_PERMISSION` для relay-to-relay падает с 403 «Forbidden IP» даже при `allowed-peer-ip=0.0.0.0-255.255.255.255`. Мы целиком отказались от WebRTC и переходим на серверный аудио-relay через WebSocket: child открывает WS, шлёт Opus-кадры, backend перебрасывает их parent'у. Латентность вырастает на ~200 мс (transit через RU-сервер), зато надёжно работает за NAT любой строгости. 152-ФЗ: аудио проходит транзитом без записи, retention=0 не меняется.
- backend: новый модуль `audio.gateway.ts` (`@nestjs/platform-ws`, native `ws`) на `/audio/ws?role={child|parent}&sessionId=…&token=…`. JWT (HS256, `AUDIO_WS_SECRET`) только для подключения к одной сессии, TTL = readyTimeout + duration + 60с.
- backend: in-memory `AudioRelay` с per-consumer backpressure — drop кадров при `bufferedAmount > 512KB`, terminate с close 4004 при > 2MB. Watchdog раз в 60с убивает сессии где producer не шлёт > 90с.
- backend: state machine упрощена `PENDING → ACTIVE → ENDED|FAILED|EXPIRED` (без `READY`); `ACTIVE` выставляется автоматически когда оба сокета подключены.
- backend: удалены HTTP signaling endpoints `POST /audio/sessions/:id/answer`, `POST /audio/sessions/:id/ice`, `POST /child/audio/sessions/:id/ready`, `POST /child/audio/sessions/:id/ice`, SSE `GET /audio/sessions/:id/events`. `generateTurnCreds()` тоже удалён.
- backend: `AUDIO_ANSWER` device-команда больше не отправляется — child получает координаты WS прямо в payload `START_AUDIO`.
- prisma migration `20260424170000_audio_drop_signaling`: убраны таблица `audio_ice_candidates`, enum `AudioIceSide`, колонки `sdpOffer`/`sdpAnswer` в `audio_sessions`. Все висящие сессии (`PENDING`/`READY`/`ACTIVE` от v0.34.x) переведены в `EXPIRED` чтобы не путать новый код.
- env: `AUDIO_WS_SECRET` (HS256 ключ ≥32 байт) и `AUDIO_WS_PUBLIC_URL` (`wss://gmd.link28rus.ru/audio/ws`). `TURN_*` переменные больше не читаются кодом (coturn будет удалён в v0.35.1 после отката web/mobile).

> ⚠ Это первый из пяти шагов плана v0.35. Web-парнер и mobile-child всё ещё на WebRTC — фронтенд будет переписан в Phase 2/3, до того момента production-сборка `0.35.0-rc.1` ломает «Звук вокруг» end-to-end. Не катить на prod до завершения Phase 5.

---

## v0.34.6 — 2026-04-24

### Исправления

- **fix(web):** SSE event state mismatch — backend шлёт `state: 'ICE'` с payload `{side, candidate}`, а клиент проверял `state === 'ICE_FROM_CHILD'`. В итоге parent **игнорировал все** ICE candidates от child → `addIceCandidate` никогда не вызывался → `remoteCandidate` список пустой → `pc.connectionState` застревал в `"new"` → RTP не шёл → track оставался `muted: true` → тишина в динамиках. Правильный backend-контракт документирован в `docs/audio-api.md` §7.2, но в клиентском коде было старое имя. Диагностировано через `pc.getStats()` на реальной prod-сессии Plan E.

---

## v0.34.5 — 2026-04-24

### Исправления

- **fix(web):** `AudioSessionController` больше не вызывает `addTransceiver('audio', {direction: 'recvonly'})` заранее. Этот вызов создавал transceiver **без** mid, а после `setRemoteDescription(offer)` Chrome добавлял **второй** transceiver c mid="0" (от m-line child'а) — в итоге в answer-SDP parent было два audio-секции. ICE candidates от child не matched правильно → `pc.connectionState` застревал в `"new"`, RTP audio не шёл, трек оставался `muted: true`. UI показывал «Подключено» (backend ставит ACTIVE после answer, а не после media flow), но звука не было. Plan E E2E на Xiaomi HyperOS 15.

---

## v0.34.4 — 2026-04-24

### Исправления

- **fix(backend):** TTL команд `AUDIO_ANSWER` (60s → 180s) и `STOP_AUDIO` (30s → 180s). В Plan E E2E оказалось: parent успешно отправлял answer, backend создавал команду `AUDIO_ANSWER`, но child-poll привязан к location-heartbeat (каждые 120с) — и команда expire'илась за 60с до того как её забрали. Теперь TTL перекрывает 1-2 poll-цикла. Правильное решение — отдельный command-poll timer в mobile-child, это post-MVP работа.

---

## v0.34.3 — 2026-04-24

### Исправления

- **fix(mobile-child):** `soundAroundEntryPoint` удалялся AOT tree-shaker'ом в release-build, несмотря на `@pragma('vm:entry-point')`. В debug-build всё работало. Symptom: native `SoundAroundService` стартовал, логгировал `startFlutterEngine OK`, но Dart-isolate не запускался — логи `[sound_around] soundAroundEntryPoint: starting headless isolate` не появлялись, сессия expire'илась с `PARENT_TIMEOUT`. Fix: в `main.dart` держим ссылку на `soundAroundEntryPoint` (как уже делали для `locationEntryPoint` — именно этот паттерн был задокументирован, но применён не ко всем entrypoint'ам). Обнаружено в Plan E E2E.

---

## v0.34.2 — 2026-04-24

### Исправления

- **fix(mobile-child):** `gmd.child/sound_around` MethodChannel теперь регистрируется и в background Dart isolate (LocationForegroundService), не только в UI-engine (MainActivity). Причина: POLL-команда `START_AUDIO` приходит в фоне через ingestor — и именно там вызывался `MethodChannel.invokeMethod('start', ...)`, который падал с `MissingPluginException` → команда никогда не ack'алась → backend expire'ил сессию с `PARENT_TIMEOUT`. Плагин-регистрация вынесена в helper `SoundAroundChannel.kt`, вызывается из обоих engine'ов. Обнаружено в Plan E E2E на Xiaomi HyperOS 15.
- **fix(web):** `AudioListenDialog` вынесен в inner-компонент `AudioSessionPane`, который монтируется только когда `open=true`. Раньше `useAudioSession` hook жил в outer-компоненте и не размонтировался при закрытии модалки — при повторном открытии state оставался `expired`/`ended`, useEffect автостарта не срабатывал (триггер `state === 'idle'` не выполнялся). Теперь каждое открытие диалога — fresh hook.

### Изменения

- chore: версия `0.34.1 → 0.34.2`, build number mobile-child `38 → 39`.
- chore(infra): `app_settings.audio.child_ready_timeout_sec` на prod увеличен 45 → 180 для запаса под polling-цикл mobile-child (heartbeat каждые 120 сек).

---

## v0.34.1 — 2026-04-24

### Исправления

- **fix(web):** `useAudioSession.start()` вызывает `cleanup()` до создания новой сессии — защита от stale `controllerRef` при re-open диалога того же ребёнка
- **fix(web):** `AudioListenDialog` useEffect автостарта зависит от `sessionState/sessionStart`, не от всего объекта `session` — убраны лишние перезапуски эффекта на каждом рендере
- **fix(web):** `AudioSessionController` больше не маппит `RTCPeerConnection.connectionState='disconnected'` в `failed` — `disconnected` часто транзиентный (recovery до `connected`); failed трактуется только для терминальных `failed`/`closed`
- **docs:** комментарий к enabled-гейту `useAudioSse` в `useAudioSession` — явно описан цикл abort fetch-стрима в терминальных состояниях

Post-code-review фиксы Plan C (см. финальный ревью v0.34.0).

---

## v0.34.0 — 2026-04-24

### Новые возможности

- **«Звук вокруг ребёнка» — web-кабинет родителя** — в меню действий ребёнка появилась кнопка «Звук вокруг». По клику открывается модалка с live-аудио через WebRTC (TURN-relay, force-relay для защиты parent IP), таймером обратного отсчёта 5 минут, индикатором уровня звука (VU-meter через Web Audio API) и понятными ошибками для каждой причины FAILED/EXPIRED. Реализована на нативном WebRTC API + custom SSE-хуке через `fetch`+`ReadableStream` (поддержка `Authorization: Bearer` — `EventSource` не умеет headers). Модулярная архитектура: `AudioSessionController` (plain TS state-machine, unit-тестируется без браузера), `useAudioSse` и `useAudioSession` React-хуки, `AudioListenDialog` UI-компонент. Вместе с v0.32.x backend и v0.33.x mobile-child даёт end-to-end фичу на web.

### Изменения

- chore(web): новые файлы — `app/api/audio/sessions/**` (proxy routes), `lib/api/audio.ts`, `lib/hooks/use-audio-sse.ts`, `lib/hooks/use-audio-session.ts`, `lib/webrtc/{audio-session-controller,vu-meter}.ts`, `components/children/audio-listen-dialog.tsx`
- chore(web): `jest.setup.ts` полифилы `TextDecoder`/`ReadableStream` для SSE-тестов под jsdom
- docs: Plan C — web-parent UI (SSE + WebRTC) добавлен в `docs/superpowers/plans/`

### Известные ограничения

- Mobile-parent (Flutter) остаётся заглушкой — отдельный план после того как появятся базовые экраны (auth/children/map).
- EULA + claim-invite consent UI для аудиомониторинга (152-ФЗ) — отдельный Plan D перед публичным запуском.
- Autoplay audio может быть заблокирован браузером при первом использовании — пользователь должен кликнуть где-то на странице (dialog открывается по клику, обычно это уже достаточно).

---

## v0.33.1 — 2026-04-23

### Исправления

- **fix(mobile-child):** `?message` experimental Dart-syntax заменён на safe collection-if в `audio_api.dart` — сборка на других Flutter-каналах теперь безопасна
- **fix(mobile-child):** double-engine guard в `SoundAroundService.onStartCommand` — защита от race при повторной START_AUDIO команде во время активной сессии
- **fix(mobile-child):** auto-stop Timer запускается ДО `sendReady` POST — медленная сеть больше не расширяет реальное время записи сверх заявленного durationSec (privacy fix)
- **fix(mobile-child):** PERMISSION_DENIED detection — расширены substring-проверки (русские сообщения, `record_audio`, `отказано`)
- **fix(mobile-child):** `DiagLog.redactTurnCreds` — TURN password/credential маскируются в diag-логах (защита от утечки при shoulder-surfing)
- **docs:** документирован assumption ICE-candidate single-m-line audio-only для Plan C reconstruction

---

## v0.33.0 — 2026-04-23

### Новые возможности

- **«Звук вокруг ребёнка» — mobile-child Android** — реализована Android-сторона аудиомониторинга. Native `SoundAroundService` (FGS типа `microphone`, требование Android 14+) поднимается по `START_AUDIO` команде из существующего poll'а DeviceCommand'ов. Headless FlutterEngine в сервисе через `flutter_webrtc` создаёт `RTCPeerConnection` (force-relay TURN), захватывает микрофон с echo-cancellation/noise-suppression/AGC, отправляет SDP-offer через `/child/audio/sessions/:id/ready`, обменивается ICE-кандидатами через `/ice`. SDP-answer от parent доставляется через новую `AUDIO_ANSWER` команду (v0.32.1) и применяется через bridge foreground→native→background engine. Auto-stop по `durationSec` или явной `STOP_AUDIO` команде. Hidden-mode по умолчанию: ребёнку не показываются push/баннеры, но system-level privacy indicator Android (зелёная точка) появляется автоматически и не может быть скрыт. Permission-wizard расширен шагом для `RECORD_AUDIO` с OEM-инструкциями для Xiaomi/HyperOS, Honor MagicOS, Samsung. OEM-инструкции в battery_step также упоминают микрофон.

### Изменения

- chore: добавлен `flutter_webrtc ^1.4.1` в pubspec mobile-child (вместо устаревшей 0.11.x с V1 embedding)
- chore: compileSdk 34 → 36 (требование транзитивных зависимостей)
- chore: новые файлы — `lib/features/sound_around/` (entry, controller, command_handler), `lib/core/native/sound_around_channel.dart`, `lib/core/api/audio_api.dart`, native `SoundAroundService.kt`
- chore: AndroidManifest — `RECORD_AUDIO` + `FOREGROUND_SERVICE_MICROPHONE` permissions, declare сервис с `foregroundServiceType="microphone"`

### Известные ограничения

- iOS не поддерживается (mobile-child Android-only на MVP).
- Smoke-test на реальном устройстве не проводился в CI session — требует authorized adb device для финальной верификации end-to-end handshake.
- OEM (Xiaomi/HyperOS, Honor) могут убить FGS микрофона при экономии батареи — mitigation через OEM-wizard инструкции, но не 100% надёжно.

---

## v0.32.1 — 2026-04-23

### Исправления

- fix(audio): доставка SDP-answer на child через новый DeviceCommand тип `AUDIO_ANSWER` — без этого child-устройство не завершало WebRTC-handshake, фича end-to-end не работала (обнаружено при написании Plan B mobile-child)

---

## v0.32.0 — 2026-04-23

### Новые возможности

- **«Звук вокруг ребёнка» — backend и infra** — добавлен TURN-сервер coturn в docker-compose (dev + prod) с SSRF-hardening и узким relay-port range; Prisma-схема `audio_sessions` + `audio_audit_log` + `audio_ice_candidates` с UNIQUE partial index для предотвращения race condition; REST API для родителя (`POST /audio/sessions`, `/answer`, `/ice`, `/stop`, SSE `/events`), для ребёнка (`/ready`, `/ice`, `/error`) и админки (settings GET/PATCH + sessions list); HMAC-SHA1 TURN-credentials генератор (RFC 5766); state-machine `PENDING→READY→ACTIVE→ENDED|FAILED|EXPIRED`; hidden-mode (без push/баннера ребёнку, system privacy indicator Android всё равно появится); 5 минут default + админ-настройки `audio.*`; pg_cron retention 90д для сессий и 365д для audit + watchdog для застрявших сессий. Mobile-клиенты ещё не реализованы — ждут Plans B/C.

### Изменения

- chore: новый модуль `apps/backend/src/audio/`, Prisma migrations `audio_sessions` + `audio_schema_fixes` + `audio_sessions_unique_active`
- chore: расширен `DeviceCommandType` enum (`+START_AUDIO`, `+STOP_AUDIO`)
- chore: dev-postgres переключён на кастомный Dockerfile с pg_cron extension
- chore: AppSettingsService расширен `getBool` helper и audio.\* keys
- docs: новый файл `docs/audio-api.md` (1100+ строк) — полная документация API для будущих mobile-разработчиков

---

## v0.31.3 — 2026-04-23

### Новые возможности

- **Настройка фильтрации GPS-шума из админки** — на `/admin/settings` появилась секция «Фильтрация GPS-шума» с тремя параметрами: порог точности, окно dedup и минимальный сдвиг. Каждый параметр можно поправить без пересборки и деплоя — изменения применяются ко всему потоку входящих точек в течение минуты. Диапазоны валидируются: значения вне границ отклоняются со 400-ответом, случайно «положить» ingest нельзя.
- **Подробные описания параметров с примерами** — рядом с каждой настройкой теперь есть значок ⓘ. По клику раскрывается подробное описание: что делает параметр, диапазон значений, примеры «что будет если поставить X». Полезно при первичном тюнинге и объяснении «почему мы именно так».

### Изменения

- backend: новые ключи `AppSettings` — `location.accuracy_floor_m` (default 100), `location.jitter_window_ms` (default 60000), `location.jitter_min_dist_m` (default 30). Seed в `onModuleInit` — идемпотентен, старые БД получат defaults автоматически при первом старте v0.31.3.
- backend: `LocationsService.ingestBatch` читает пороги из `AppSettingsService.getNumber()` (кеш 60с) вместо файловых констант — админ меняет настройку, и через минуту она применяется без рестарта.
- backend: в `AppSettingsService.update()` добавлена валидация диапазонов через `KEY_BOUNDS`. Попытка сохранить `accuracy_floor_m=1` или `jitter_window_ms=-5` возвращает 400 `value_out_of_range`.
- web: секция «Фильтрация GPS-шума» добавлена первой в `settings-client.tsx` с тремя ключами и понятными лейблами (`Порог точности`, `Окно dedup-а`, `Мин. сдвиг`).
- web: `SettingRow` получил раскрываемый блок с описанием через кнопку ⓘ (lucide `Info`). Показывается, если `row.description` непусто — для всех существующих ключей в БД, не только GPS.
- mobile-child: без изменений. APK v0.31.2 остаётся актуальным.

---

## v0.31.2 — 2026-04-23

### Улучшения

- **Экономия батареи начинается с первой секунды после старта** — если разрешение «Физическая активность» уже дано, GPS-сервис стартует сразу в STILL-режиме (5-минутный интервал) вместо того, чтобы полторы минуты работать вхолостую на 10-секундных апдейтах, пока Activity Recognition вычислит, что ребёнок неподвижен. Экономия заметна особенно после перезагрузок телефона.
- **Индикатор режима GPS на главном экране ребёнка** — в шапке появился небольшой чип «💤 Экономия» (зелёный, режим STILL) или «📡 Активно» (синий, режим ACTIVE). Обновляется раз в 3 секунды. Ребёнок и родитель могут сами видеть, в каком режиме работает сервис.

### Изменения

- mobile-child: `LocationForegroundService.start()` определяет initial profile по результату `checkSelfPermission(ACTIVITY_RECOGNITION)` — granted → STILL, denied или Android <10 → ACTIVE.
- mobile-child: safety net `ensureActiveFallback()` — если регистрация Activity Recognition завалилась (Play Services отсутствуют / SecurityException / unexpected), а сервис уже в STILL, автоматически переключаемся на ACTIVE. Иначе без MOVING_ENTER-событий ребёнок застрял бы в 5-минутном режиме навсегда.
- mobile-child: профиль персистится в `SharedPreferences("gmd_location_state").current_profile` при каждом `switchProfile()`. Dart-сторона читает через новый `MethodChannel` method `getCurrentProfile` в `MainActivity`.
- mobile-child: новый виджет `apps/mobile-child/lib/features/home/location_profile_indicator.dart` (Riverpod `StreamProvider` с 3-секундным поллингом), встроен в `AppBar.actions` home-экрана слева от версии.
- mobile-child: новый enum `LocationProfile { unknown, active, still }` в `LocationServiceChannel` + метод `getCurrentProfile()` через тот же `ru.link28rus.gmd.child/location` канал.

---

## v0.31.1 — 2026-04-23

### Улучшения

- **Баннер «Включи экономию батареи» на главном экране ребёнка** — пользователи, обновившиеся с v0.30.x/0.31.0 без переустановки, не проходили новый шаг онбординга «Физическая активность» и не могли дать permission `ACTIVITY_RECOGNITION`, без которого STILL-режим GPS не включается. Теперь на `/home` показывается ненавязчивый амбер-баннер со ссылкой на системный диалог выдачи разрешения. После grant'а сервис перезапускается автоматически и подписывается на Activity Recognition transitions.

### Изменения

- mobile-child: новый виджет `apps/mobile-child/lib/features/home/activity_recognition_banner.dart` — stateful-баннер, реагирующий на `AppLifecycleState.resumed` (чтобы перечекать permission при возврате из системных настроек). На Android < 10 permission_handler возвращает `isGranted` автоматически, баннер не показывается. Встроен в `home_screen.dart` после `PermissionHealthBanner`.
- mobile-child: после `Permission.activityRecognition.request()` внутри баннера вызывается `LocationServiceChannel.stopService()` + `startService()`, чтобы `LocationForegroundService.registerActivityTransitions()` перерегистрировал подписку с учётом нового granted-статуса. Без рестарта сервис остался бы в active-only режиме до следующего boot'а.

---

## v0.31.0 — 2026-04-23

### Новые возможности

- **Адаптивная экономия батареи у ребёнка** — приложение ребёнка теперь определяет, что телефон лежит неподвижно, и переключает GPS в режим редких обновлений (раз в 5 минут вместо каждых 10 секунд). Когда ребёнок снова идёт или едет — возвращается в активный режим автоматически. Экономит 30-40% батареи за день стоянок. Требует разрешения «Физическая активность» в новом шаге онбординга (можно пропустить — фильтр точности всё равно работает).
- **Чистая карта без «звезды» GPS-шума в помещениях** — точки с плохой точностью (дрожание GPS внутри зданий) теперь отсеиваются на трёх уровнях: на телефоне ребёнка (accuracy > 75м), на сервере (accuracy > 100м) и в интерфейсе родителя (accuracy > 50м). Трек между «стоянками» упрощается алгоритмом Douglas-Peucker, завершённые поездки рендерятся как «П»-маркеры с тултипом «Был тут в 14:20 · поездка 45 мин». Трек теперь отражает реальные перемещения, а не дрожь сигнала.

### Улучшения

- mobile-child: `LocationForegroundService` использует `PRIORITY_BALANCED_POWER_ACCURACY` вместо `PRIORITY_HIGH_ACCURACY` — FLP меньше полагается на GPS и больше на Wi-Fi/cell-anchor'ы в помещении, на улице автоматически переключается на GPS. Порог перемещения FLP поднят с 5м до 20м.
- mobile-child: stationary-dedup на уровне listener'а — если новая точка в радиусе `max(2·accuracy, 30м)` от последней отправленной и прошло меньше 60 сек, точка не уходит в очередь на сервер. Heartbeat каждые 2 минуты работает без dedup'а — родитель всегда видит «был тут только что».
- web: при просмотре дня карта подтягивает `GET /children/:id/trips?from=...&to=...` и рисует stop-маркеры поверх трека (данные из `TripsService`, считающего поездки на бэке).

### Изменения

- mobile-child: новый класс `ActivityTransitionReceiver.kt` подписывается на Activity Recognition API (STILL/IN_VEHICLE/ON_FOOT/ON_BICYCLE) и шлёт `ACTION_ACTIVITY_STILL`/`ACTION_ACTIVITY_MOVING` в сервис для переключения профиля FLP.
- mobile-child: permission `android.permission.ACTIVITY_RECOGNITION` объявлен в манифесте, запрашивается на новом шаге онбординга `/permissions/activity`. Wizard-стэпы пронумерованы заново (было 4 шага, стало 5).
- backend: `LocationsService.ingestBatch` сортирует точки батча по `recordedAt` и применяет два новых reject-reason: `low_accuracy` (accuracy > 100м) и `jitter` (перемещение < `max(2·accuracy, 30м)` относительно предыдущей точки того же девайса за окно 1 минуты). Safety net для старых APK (v0.30.x), продолжающих слать indoor-мусор.
- web: новый helper `apps/web/lib/geo/douglas-peucker.ts` (итеративный, без рекурсии) + новый хук `useTripsList` (`apps/web/lib/hooks/use-trips-list.ts`).
- web: `TrackPolyline` принимает опциональный пропс `stops?: TripDto[]`; при его наличии middle-dot'ы скрываются, вместо них рисуются крупные амбер-маркеры «П» в точках endLat/endLon каждой завершённой поездки.
- docs: 6 новых unit-тестов для бэкенда (`low_accuracy`, `jitter` — разные сценарии) + 2 новых для web (accuracy-фильтр, stops).

---

## v0.30.1 — 2026-04-23

### Улучшения

- **Яндекс.Карты тоже переключаются между светлой и тёмной темами** — карта на главной `/cabinet` и все карты на `/cabinet/zones` (список зон + редактор) теперь рисуются тёмными тайлами при выборе «средней» или «тёмной» темы в переключателе. В светлой теме — классические светлые тайлы.

### Изменения

- web: `ChildMapInner`, `ZonesMapInner`, `ZoneEditorMapInner` читают тему из `useTheme()` и пробрасывают её в `<YMapDefaultSchemeLayer theme="light|dark" />`. Темы `dim` и `dark` в UI оба маппятся в `dark` для карты — одинаковые карточные тайлы, чтобы не слепить глаза на приглушённом интерфейсе.

---

## v0.30.0 — 2026-04-23

### Новые возможности

- **Светлая, средняя и тёмная темы** — в веб-кабинете и админке появился переключатель темы (три кнопки: ☀️ светлая / ☁️ средняя / 🌙 тёмная). В админке он встроен в верхний бар справа, в кабинете — рядом с кнопкой «Админка» и аватаром (на мобильном — в выпадающем меню профиля). Выбор сохраняется между сессиями (localStorage `gmd-theme`). Публичный лендинг, страницы входа/регистрации и политика конфиденциальности остаются в исходном оформлении.

### Изменения

- web: новый client-context `ThemeProvider` (`apps/web/components/theme/theme-provider.tsx`) — ставит на `<html>` атрибут `data-admin-theme` и класс `.dark` для совместимости с `dark:` вариантами Tailwind.
- web: новый компонент `ThemeSwitcher` (`apps/web/components/theme/theme-switcher.tsx`) — сегментный radiogroup из трёх кнопок с иконками lucide-react, `backdrop-blur` для читаемости.
- web: `apps/web/app/globals.css` — добавлены блоки CSS-переменных `[data-admin-theme='light'|'dim'|'dark']` и правило для `<body>` под темой (включая `color-scheme` для нативных контролов браузера).
- web: `apps/web/app/admin/layout.tsx` и `apps/web/app/cabinet/layout.tsx` — обёртки `<ThemeProvider>`, хардкод `bg-zinc-50` заменён на `bg-background text-foreground`.
- web: `apps/web/components/admin/admin-header.tsx` — `ThemeSwitcher` встроен в хэдер справа (после ссылки «Кабинет»).
- web: `apps/web/components/cabinet/cabinet-header.tsx` — `ThemeSwitcher` между «Скачать приложение» и «Админка» на десктопе, в профиль-меню на мобильном. Хардкод `bg-white`, `text-zinc-*`, `border-zinc-*` заменён на токены (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-popover`) — хэдер теперь реагирует на смену темы.
- web: массовая замена хардкод-цветов на токены в 37 файлах (кабинет + админка) — 251 замена. Темизированы: home-экран кабинета (sidebar, карточки детей, статус-карточка, меню действий, empty-state), `/cabinet/zones` (карта геозон, список, редактор, лента событий), `/cabinet/pin`, `/cabinet/password`, `/cabinet/download`, `/cabinet/children` и `/cabinet/children/[id]/{map,history}`, весь `/admin` (дашборд, пользователи + детали, семьи, дети, приглашения, настройки), `data-table`, dropdown-меню админа, dialog привязки по QR. Семантические цвета сохранены (amber consent-banner, emerald protection toggle, red destructive, slate-900 admin-brand).

---

## v0.29.4 — 2026-04-23

### Новые возможности

- **Индикатор состояния защиты на home-экране** — на экране ребёнка теперь всегда виден компактный статус «Защита от удаления»:
  - 🔒 зелёный замок + «Включена» — защита активна (Device Admin работает)
  - 🔓 серый открытый замок + «Выключена в кабинете родителя» — родитель выключил тумблер
  - 🔓 красная плашка + «Защита НЕ активна» — защита включена в кабинете, но Device Admin не активирован на устройстве (требуется действие)
- Без копания в DiagLog видно ГДЕ защита на самом деле работает, а где только в БД.

### Изменения

- mobile-child (Dart): новый widget `_StatusTile` в `protection_banner.dart` — always-visible indicator для allGood/disabled состояний.
- mobile-child (Dart): `_Banner` теперь принимает `icon` параметр (для красной плашки используем `Icons.lock_open`).
- mobile-child build number: `+33 → +34` (RuStore versionCode).

---

## v0.29.3 — 2026-04-23

### Исправления

- **Защита от удаления на Xiaomi/MIUI теперь реально работает** — в v0.29.2 тумблер защиты мог быть ON в кабинете, но на телефонах Xiaomi/Redmi/Poco (MIUI 14+/HyperOS) Device Admin не активировался из-за «Ограниченных настроек» (Restricted Settings) для sideload-APK. Ребёнок мог спокойно удалить приложение через launcher → long-press → trash. Теперь mobile-child показывает пошаговый wizard: шаг 1 — «Разрешить ограниченные настройки» в карточке приложения; шаг 2 — активация Device Admin через системный диалог. Автозакрытие wizard'а после успешной активации.

### Улучшения

- **Красная плашка «Защита НЕ активна»** — вместо жёлтой «Защита приложения не включена». Ребёнок/родитель не пропустит критическое состояние: если backend `enabled=true`, но Device Admin на устройстве не активирован — плашка красная с явным предупреждением «Устройство можно удалить».
- **Автопоказ wizard при первом появлении** — при заходе на home ребёнка с активной защитой в кабинете, но неактивным admin на телефоне, wizard открывается автоматически (не нужно тапать по banner).
- **Банер не скрывается при сетевой ошибке** — если `GET /child/protection` недоступен, полагаемся на локальный кеш (`enabled=true` по умолчанию). Раньше баннер исчезал при любой ошибке сети — невидимая защита.

### Изменения

- mobile-child (Android): возвращены MethodChannel-хендлеры `deviceManufacturer` и `openAppDetailsSettings` — нужны для Xiaomi-wizard (в v0.29.2 были удалены вместе с a11y wizard ошибочно).
- mobile-child (Dart): `_AdminWizard` bottom-sheet — аналог `_AccessibilityWizard` из v0.28.0, но для Device Admin flow. На Xiaomi/Redmi/Poco — 2 шага (restricted settings + activation), на остальных — 1 шаг.
- mobile-child (Dart): `DeviceAdminChannel` вернулись `openAppDetailsSettings()` и `deviceManufacturer()`.
- mobile-child build number: `+32 → +33` (RuStore versionCode).

---

## v0.29.2 — 2026-04-23

### Исправления

- **Убран PIN-запрос при удалении приложения** — в v0.29.1 даже при выключенном тумблере защиты, если у ребёнка в настройках был активирован `GmdAccessibilityService`, системный экран «Отключить администратора устройства» перехватывался и показывалась модалка ввода PIN. Теперь PIN-lock (L2) удалён полностью: защита держится только на Device Admin L1, как у конкурентов («Где мои дети», «Пинго»). Родитель выключает тумблер в кабинете → приложение само отзывает admin → ребёнок удаляет обычным способом. Без PIN.

### Изменения

- mobile-child (Android): `GmdAccessibilityService` превращён в пустой no-op (onAccessibilityEvent ничего не делает). Класс оставлен в коде, но запись `<service>` в манифесте удалена — у уже включивших a11y-сервис пользователей Android автоматически пометит его как недоступный.
- mobile-child (Android): удалены `PinLockActivity.kt` + `activity_pin_lock.xml` + `xml/gmd_accessibility_service.xml` + строки `gmd_pin_lock_*` в `strings.xml` + permission `USE_FULL_SCREEN_INTENT`.
- mobile-child (Android): `MainActivity` очищен от MethodChannel-хендлеров `isAccessibilityEnabled`/`openAccessibilitySettings`/`openAppDetailsSettings`/`deviceManufacturer` и приватного `isAccessibilityServiceEnabled()`.
- mobile-child (Dart): `ProtectionState` упрощён (`enabled` + `adminActive`, без `accessibilityActive`). Удалён `_AccessibilityWizard` bottom-sheet с шагами Xiaomi restricted-settings → a11y. Банер показывается только когда `enabled && !adminActive`.
- mobile-child (Dart): `DeviceAdminChannel` очищен от `isAccessibilityEnabled`/`openAccessibilitySettings`/`openAppDetailsSettings`/`deviceManufacturer`.
- mobile-child build number: `+31 → +32` (обязательно для RuStore versionCode).

---

## v0.29.1 — 2026-04-23

### Исправления

- **Тумблер защиты теперь реально снимает защиту с устройства** — раньше `PATCH /family/children/:id/protection` переключал только серверный флаг, а на устройстве ребёнка Device Admin и AccessibilityService оставались активными (при попытке удалить приложение всё равно требовался PIN). Теперь при `enabled=false` на mobile-child приложение само отзывает себя из Device Admin (`removeActiveAdmin`), а `GmdAccessibilityService` делает early-return — перехват «опасных» экранов отключается. Срабатывает при следующем resume home-экрана ребёнка (обычно через несколько секунд).

### Инфраструктура

- mobile-child (Kotlin): `NativeCreds.setProtectionEnabled/isProtectionEnabled` — кеш флага в SharedPreferences (default=true).
- mobile-child (Kotlin): новые MethodChannel-методы `deactivate` и `setProtectionCache` в `MainActivity`.
- mobile-child (Kotlin): `GmdAccessibilityService.onAccessibilityEvent` читает кеш и ранним return выходит при `enabled=false`.
- mobile-child (Dart): `protectionStateProvider` после получения state с backend вызывает `setProtectionCache(enabled)` и, если `enabled=false && adminActive`, автоматически дёргает `deactivate()`.
- mobile-child build number: `+30 → +31` (обязательно для RuStore versionCode).

---

## v0.29.0 — 2026-04-23

### Новые возможности

- **Защита от удаления — простой тумблер без PIN** — в карточке выбранного ребёнка появился переключатель «Защита от удаления». Одно нажатие включает/выключает защиту, без модалки ввода PIN. Работает по аналогии с «Где мои дети / Пинго». Бэкенд-флаг `Child.protectionEnabled` управляется по `PATCH /family/children/:childId/protection` — теперь просто под JWT, без `PinVerifiedGuard`.

### Улучшения

- **Действия доступны даже при падении карты Яндекса** — `MapErrorFallback` теперь рендерит панель действий (история, защита, сигнал, отвязать, удалить), чтобы родитель мог управлять ребёнком при временном сбое карты.

### Изменения

- backend: `PATCH /family/children/:childId/protection` снят `PinVerifiedGuard`, `setProtection` больше не требует `pinHash` (защита включается «L1-only» даже без PIN-gate на детском устройстве).
- backend: `GET /family/children` возвращает `protectionEnabled` и `protectionEnabledAt` в списке — UI рендерит тумблер по этому полю.
- web: новый route `/api/children/[id]/protection` (proxy), хук `useToggleProtection`, компонент тумблера встроен в `ChildActions`.
- tests: обновлён `children.service.spec` — enable=true без pinHash проходит (было `BadRequestException pin_not_set`, стало `enabled=true`).

---

## v0.28.0 — 2026-04-22

### Новые возможности

- **Страница PIN-кода родителя в кабинете** — `/cabinet/pin` с формами «Задать / Сменить / Удалить PIN». 4–8 цифр, маскированный ввод с подтверждением. Удаление PIN требует ввода текущего и каскадно выключает защиту на всех устройствах детей. Ссылка в меню профиля рядом с «Сменить пароль».
- **Wizard Accessibility стал реактивным (mobile-child)** — шаги помечаются галочкой когда выполнены, весь bottom-sheet автозакрывается как только Accessibility Service стал активен. Пока пользователь ходит в системные настройки и обратно — плашка на home тоже пересчитывается через AppLifecycleState.resumed.

### Инфраструктура

- Web: новые route handlers `/api/me/pin` (GET/POST/DELETE) и `/api/me/pin/verify` — проксируют к backend с Bearer-токеном.
- Web: `AuthUser.hasPin` добавлен в `auth-store`, меню профиля различает «Задать PIN» / «Сменить PIN».
- Mobile-child: `_AccessibilityWizard` теперь `ConsumerStatefulWidget` с `WidgetsBindingObserver` + локальным state шагов. Автозакрытие через `Navigator.pop` в `postFrameCallback` когда `accessibilityActive=true`.

---

## v0.27.2 — 2026-04-22

### Исправления

- **PIN-плашка не появлялась на Android 12+/HyperOS** — `startActivity(PinLockActivity)` из AccessibilityService блокировался системным правилом background activity start. Теперь L2 выставляет full-screen notification с `setFullScreenIntent` — официальный путь запустить Activity поверх системного экрана из фонового сервиса. Канал `gmd_pin_lock`, IMPORTANCE_HIGH, CATEGORY_CALL, USE_FULL_SCREEN_INTENT.

### Инфраструктура

- Permission `USE_FULL_SCREEN_INTENT` в AndroidManifest.
- `GmdAccessibilityService.showPinLockNotification()` — создаёт канал at-first-use, full-screen PendingIntent к `PinLockActivity`.
- Лог `a11y: pin-lock notification posted (fullScreenIntent)` — контрольная точка в DiagLog.

---

## v0.27.1 — 2026-04-22

### Улучшения

- **Онбординг Accessibility для Xiaomi/HyperOS** — MIUI/HyperOS блокирует включение «Спец.возможности» для sideload-APK (предупреждение «Контролируется настройками с ограниченным доступом»). Теперь по тапу на плашку «Остался один шаг» открывается bottom-sheet с двумя шагами: (1) открыть карточку приложения, чтобы в меню ⋮ выбрать «Разрешить ограниченные настройки»; (2) открыть спец.возможности и включить сервис. На других производителях показывается только один шаг. Определение OEM — по `Build.MANUFACTURER` (xiaomi/redmi/poco).

### Инфраструктура

- Новые MethodChannel-методы: `openAppDetailsSettings` (Intent `ACTION_APPLICATION_DETAILS_SETTINGS` с `package:…`), `deviceManufacturer`.
- `DeviceAdminChannel.openAppDetailsSettings()` / `.deviceManufacturer()` в Dart.

---

## v0.27.0 — 2026-04-22

### Новые возможности

- **L2 защита от удаления через AccessibilityService** — теперь ребёнок не может отключить администратора устройства или удалить приложение даже из Settings → Security → Device Administrators. При попытке открыть подтверждающий экран (Uninstall, Force stop, Deactivate administrator) сервис перехватывает навигацию и показывает нативную плашку ввода PIN родителя. После ввода корректного PIN включается «окно разрешения» 30 сек — ребёнок может завершить законное действие, затем защита снова активна.

### Инфраструктура

- Новый backend-эндпоинт `POST /child/protection/verify-pin` под `ChildAuthGuard` — ребёнок верифицирует PIN родителя по device-token. Проверяется против хешей всех родителей в семье (любой валиден). Rate-limit per-childDevice: 5 неверных подряд → lock 15 мин. Ошибки: 401 `invalid_pin`, 401 `no_parent_pin`, 429 `pin_locked`.
- Android: новый `GmdAccessibilityService` + `accessibility_service_config.xml`, `PinLockActivity` (нативная Kotlin-Activity с XML-layout, `HttpURLConnection` без Flutter engine), `NativeCreds` (зеркало deviceToken + apiBaseUrl в plain SharedPreferences для чтения из нативного слоя).
- Android разрешение `BIND_ACCESSIBILITY_SERVICE` декларируется на сервисе — активация только через Settings → Accessibility вручную.
- В кабинете ребёнка добавилась вторая плашка «Остался один шаг» (оранжевая) — предлагает включить Accessibility Service после активации Device Admin.
- ENV для сборки: `API_BASE_URL` должен быть передан через `--dart-define` или выставлен в `env.dart` — `NativeCreds` ссылается на него при HTTP-запросе с нативного слоя.

---

## v0.26.0 — 2026-04-22

### Новые возможности

- **Защита от удаления на устройстве ребёнка (L1 Device Admin)** — mobile-child теперь умеет активировать себя как Device Administrator в Android. Пока режим активен, системные настройки заменяют кнопку «Удалить» на «Отключить администратора устройства» — ребёнок не может снести приложение одним тапом. На главном экране появилась янтарная плашка «Защита приложения не включена» — показывается только если защита включена родителем через кабинет, но на устройстве ещё не активирована; тап по плашке открывает системный диалог подтверждения. После возврата из диалога статус перечитывается автоматически.

### Инфраструктура

- Android: новый `ChildDeviceAdminReceiver` + `res/xml/device_admin_policies.xml` (минимальный набор policies — достаточно для блокировки Uninstall). `AndroidManifest.xml`: receiver с `BIND_DEVICE_ADMIN` и intent-filter на `DEVICE_ADMIN_ENABLED`.
- `MainActivity`: новый MethodChannel `ru.link28rus.gmd.child/protection` — методы `isActive`, `requestActivation` (ACTION_ADD_DEVICE_ADMIN с русским explanation), `openSettings`.
- Flutter: `DeviceAdminChannel` + `ProtectionBanner` (watcher через `WidgetsBindingObserver.didChangeAppLifecycleState`, invalidate провайдера при возврате в foreground).
- Новый backend-эндпоинт `GET /child/protection` под `ChildAuthGuard` — отдаёт `{enabled: boolean}` для текущего устройства по device-token (без участия родителя в auth-flow).

### Что следующее

- PIN-интеграция в Device Admin deactivation (L2 AccessibilityService overlay) — сейчас `onDisableRequested` возвращает только текст-предупреждение, но не блокирует. Решение — отдельной итерацией.
- Web UI в кабинете родителя: страница PIN-кода (задать/сменить) + toggle «Защита от удаления» на карточке ребёнка. Backend для обоих уже готов (v0.25.0).

---

## v0.25.0 — 2026-04-22

### Новые возможности

- **PIN-код родителя** — единый секрет для подтверждения критичных действий: защиты от удаления приложения ребёнка (включение/выключение дистанционно), будущей разблокировки родительского приложения, подтверждения отвязки устройства. 4–8 цифр, argon2 на сервере, 5 неверных попыток подряд → блокировка на 15 минут. После удаления PIN защита на всех детях снимается каскадом.
- **Защита от удаления на устройстве ребёнка (backend)** — каждая запись ребёнка теперь имеет флаг «защита включена» с отметкой даты и автором (важно в семьях с несколькими родителями). Включение требует заранее заданного PIN и свежей PIN-верификации. Клиент подтверждает PIN один раз и может переключить защиту у нескольких детей подряд без повторного ввода (окно 5 минут).

### Инфраструктура

- Prisma: в `users` — поля `pinHash` / `pinUpdatedAt`; в `children` — `protectionEnabled` / `protectionEnabledAt` / `protectionEnabledBy`. Миграция `20260422100000_add_user_pin_and_child_protection`.
- Новый `PinService` (argon2 + Redis rate-limit и verify-marker) и `PinVerifiedGuard`. ENV: `PIN_LOCK_AFTER=5`, `PIN_LOCK_TTL_SECONDS=900`, `PIN_VERIFY_TTL_SECONDS=300`.
- Новые эндпоинты: `GET /me/pin/status`, `POST /me/pin`, `POST /me/pin/verify`, `DELETE /me/pin`, `GET /family/children/:childId/protection`, `PATCH /family/children/:childId/protection`.
- `GET /me` теперь возвращает флаг `hasPin` (рядом с `hasPassword`) — клиент использует его для выбора между «задать» и «сменить» PIN.
- 9 новых unit-тестов (PinService, UserPinService, PinVerifiedGuard, ChildrenService.setProtection). Всего по backend — 238.

---

## v0.24.2 — 2026-04-22

### Улучшения

- **Редизайн `/admin/settings` в стиле Linear** — предыдущий «terminal/engineering log» был перебором для админки с одним-двумя ключами в секции. Теперь страница выглядит как привычный product-admin: узкая центральная колонка до&nbsp;720&nbsp;px, компактный заголовок, две секции, каждая — аккуратный rounded-lg список с тонкими разделителями. Заголовки секций маленькие uppercase, рядом dot-индикатор (sky — для маршрутов, amber — для SMTP) и описание прижато справа. Убрана боковая навигация и терминал-панель.
- **Строка настройки — одна плотная линия** — label крупным, имя ключа моноширинным под ним, справа узкий input под ширину данных (32 ch для чисел, 56 ch для хостов) и компактная кнопка «Сохранить». Кнопка не мигает и не пропадает из layout — она всегда в одной и той же позиции, просто становится невидимой пока нет изменений (text-transparent), поэтому строки не скачут при вводе. После сохранения коротко показывает «OK» с галкой.
- **Зашифрованные поля помечены маленьким dot'ом** — янтарная точка рядом с названием (например, «Пароль ●»), без громоздкого бейджа `encrypted`. На hover — tooltip «Зашифровано (AES-256-GCM)».
- **Проверка SMTP — отдельная строка в списке** — последняя строка секции SMTP, со слегка серым фоном для выделения. Когда тест прошёл — dot зелёный, строка показывает `✓ delivered · <message-id>`. Когда упал — dot розовый, строка показывает текст ошибки. Результат сохраняется в строке до следующей отправки.

---

## v0.24.1 — 2026-04-22

### Улучшения

- **Редизайн `/admin/settings`** — прежний плоский список карточек превратился в страницу-журнал в стиле technical log. Сверху — заголовок «Параметры системы» крупным набором с мета-блоком (версия приложения, упоминание алгоритма шифрования). Слева — «липкое» оглавление с нумерованными якорями секций и подсветкой активного раздела при скролле. Каждая секция получила свою нумерацию (`§ 01`, `§ 02`), мини-рубрикатор-кикер (`Routes`, `Mail · SMTP`) и горизонтальные hairline-разделители. Настройки превратились из отдельных карточек в табличные строки с двумя колонками (label + описание слева, input + action справа), моноширинные ключи показываются компактной подписью.
- **Поле с секретом визуально помечено** — у пароля бейдж «encrypted», плейсхолдер в формате `•••••••• — оставьте пустым, чтобы не менять`. После удачного сохранения под полем пробегает тонкая emerald-полоса и кнопка на полторы секунды становится «Сохранено» с галкой.
- **Блок «Проверка SMTP» превратился в терминальную панель** — тёмная карточка с заголовком `smtp · диагностика`, моноширинный input-prompt (`▸ recipient@example.com`), кнопка `probe` в emerald-акценте и встроенный лог отправок (нумерованные строки, цвет подсвечивает статус: info / ok / err). После нажатия на «probe» мигающий курсор имитирует выполнение.

---

## v0.24.0 — 2026-04-22

### Новые возможности

- **Раздел `/admin/settings` сгруппирован в секции** — раньше это был плоский список ключей (`trip.idle_minutes`, `trip.idle_radius_m` и всё). Теперь есть две понятные секции: «Настройка сохранения маршрутов» (параметры сегментации поездок) и «Настройка SMTP» (почтовый сервер для отправки писем).
- **Редактирование SMTP из админки** — host, порт, пользователь, пароль и адрес отправителя лежат в БД и правятся из `/admin/settings`. Изменения применяются сразу, перезапуск backend не требуется (mailer подтягивает свежую конфигурацию при следующей отправке). Пароль хранится зашифрованно (AES-256-GCM), админу в UI не показывается — пустое поле означает «не менять», заполненное — перезаписать.
- **Кнопка «Отправить тест» в секции SMTP** — под полями конфигурации инпут email (по умолчанию — почта текущего админа) и кнопка. Отправляет тестовое письмо через текущие настройки и сразу показывает результат (успех с message-id или текст ошибки SMTP).

### Инфраструктура

- Prisma: в `AppSetting` добавлено поле `isSecret Boolean` — включает шифрование `value`. Миграция `20260422050000_app_setting_is_secret`.
- Новый `SecretsService` (AES-256-GCM, ключ из env `SMTP_SECRET_KEY`). Формат зашифрованного значения: `enc:v1:<base64(iv + ciphertext + tag)>`.
- При первом старте backend переносит `SMTP_*` из env в `app_settings` (идемпотентно). После этого env-переменные `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` становятся fallback'ами — основной источник правды — БД.
- Новый эндпоинт `POST /admin/smtp/test` — принимает `{ to }` и возвращает `{ ok, messageId | error }`.
- На prod добавлен `SMTP_SECRET_KEY` в `/opt/gmd/.env.prod` (см. memory-compiler).

---

## v0.23.0 — 2026-04-22

### Новые возможности

- **Управление семьями и детьми в админке** — разделы `/admin/families` и `/admin/children` стали рабочими инструментами, а не просто списками для просмотра. Появилось меню действий на каждой строке: удалить семью целиком (каскадом по детям, устройствам, активным приглашениям); удалить ребёнка; отозвать устройство ребёнка одной кнопкой (создать новый QR-код при необходимости родитель делает из кабинета). Soft-delete уходит в БД сразу, физическое удаление — тем же ночным cron'ом через 30 дней, что и для пользователей.
- **Поиск и фильтр «Показывать удалённых»** — в обеих вкладках добавили поиск по имени (c debounce 300мс) и чекбокс для просмотра удалённых записей. В списке семей теперь есть столбцы «Статус» (Активна/Удалена) и «Удалена», в списке детей — колонка «Удалён» была раньше, но без фильтра её было не увидеть; теперь удалённых легко найти.

### Исправления

- **«Устройство» в `/admin/children` теперь действительно показывает Онлайн/Офлайн** — раньше бэкенд отдавал статус `active`, а фронт ждал `online`/`offline`, из-за чего бейдж всегда отображался как «Онлайн» независимо от того, присылал ли телефон локации. Теперь считаем онлайн = `lastSeenAt < 5 мин назад`, иначе офлайн. `revoked` и `none` работают как раньше.

### Изменения

- Бэкенд: новые эндпоинты `DELETE /admin/families/:id`, `DELETE /admin/children/:id`, `POST /admin/children/:id/reset-device`. Эндпоинты `GET /admin/families` и `GET /admin/children` теперь принимают `?q=` и `?showDeleted=true`.

### Техническое

- Очищены тестовые аккаунты `smoke2@t.ru` и `test@test.ru` на prod: hard-delete пользователей, семей и otp-кодов.

---

## v0.22.2 — 2026-04-22

### Исправления

- fix(web): меню действий в `/admin/users` больше не обрезается — раньше оно рендерилось внутри `overflow-x-auto` таблицы и его нижние пункты («Заблокировать», «Сбросить пароль», «Удалить») клипались. Теперь меню рендерится через React-портал в `document.body` с fixed-позиционированием, пункты видны целиком. Закрытие — по клику вне меню или Esc.

---

## v0.22.1 — 2026-04-22

### Исправления

- fix(web): убрана «лишняя» полоса прокрутки в админке — `min-h` контейнера теперь учитывает высоту глобального футера, и при небольшом количестве пользователей страница помещается в один экран без скролла.

---

## v0.22.0 — 2026-04-22

### Новые возможности

- **Роли «Админ» и «Родитель» в админке** — раньше админом мог быть только owner проекта, прописанный в переменной окружения `ADMIN_EMAILS`. Теперь роль хранится в БД (по умолчанию «Родитель»), админ может выдать права другому родителю через меню в `/admin/users → три точки → Сделать админом` и забрать их обратно. Env-список сохранён как аварийный fallback: если админ случайно снял с себя права, он всё равно сможет восстановить доступ.
- **Блокировка пользователя** — новое действие в меню `/admin/users`. Заблокированный пользователь не может войти ни по паролю, ни по коду из письма; все активные сессии сразу завершаются, на странице входа показывается «Аккаунт заблокирован, обратитесь к администратору». Разблокировка — одной кнопкой. Причина блокировки сохраняется и показывается подсказкой на статусном бейдже.
- **Сброс пароля админом** — админ нажимает «Сбросить пароль», пользователю на почту уходит ссылка на страницу `/reset-password` (действует 1 час), по которой он сам задаёт новый пароль. Сам пароль админу не показывается, старые refresh-сессии при смене инвалидируются.
- **Удаление пользователя админом** — мягкое удаление через меню. Если удаляемый — единственный родитель в семье, вся семья (дети, устройства, зоны, активные приглашения) тоже отправляется в soft-delete и будет физически удалена ночным cron'ом через 30 дней. Если в семье есть другие родители — семья остаётся, ownership переходит к самому раннему из оставшихся.
- **«Последний заход в кабинет»** — новый столбец в `/admin/users`. Отражает реальное присутствие родителя в web-кабинете, а не просто успешный логин: кабинет шлёт heartbeat каждые 2 минуты, пока вкладка открыта и видна. Значение человекочитаемое — «только что / 5 мин назад / вчера / 18.04.2026».

### Изменения

- Страница `/login`: при попытке входа заблокированного пользователя показывается отдельное сообщение вместо общей ошибки.

### Инфраструктура

- Prisma: в `User` добавлены `role` (enum `admin | parent`, default parent), `blockedAt`, `blockedReason`, `blockedById`, `lastSeenAt`. Новая таблица `password_reset_tokens` — SHA-256 хэш токена, TTL 1 час, однократное потребление. Миграция сразу выдаёт `role='admin'` пользователю с email `link28rus@ya.ru` (bootstrap).

---

## v0.21.1 — 2026-04-22

### Исправления

- fix(web): обёртка `/confirm-email` в Suspense — prod-билд Next.js 15 падал на prerender без boundary вокруг `useSearchParams`.

---

## v0.21.0 — 2026-04-22

### Новые возможности

- **Регистрация через форму + подтверждение email** — раньше вход по коду из письма автоматически создавал аккаунт «на лету» для любой почты. Теперь есть явный экран регистрации `/register`: «Фамилия» и «Имя» обязательны, «Отчество» — по желанию; поле «Назови семью» необязательно, если пусто — подставляется фамилия. После отправки формы на указанный email приходит ссылка подтверждения (действует 24 часа). Клик по ссылке сразу логинит и кидает в кабинет — без отдельного шага «войдите».
- **Страница `/confirm-email`** — красивая страница результата: spinner на старте, зелёная галочка и редирект в кабинет при успехе, объясняющая ошибка с CTA «Зарегистрироваться» при невалидной/истёкшей ссылке.

### Улучшения

- **Явные ошибки на `/login`** — если почта не найдена или не подтверждена, кабинет показывает понятное сообщение и кнопку «Зарегистрироваться» прямо в блоке ошибки, а не молча говорит «неверный код».
- **Повторная регистрация того же email**, пока не подтверждён, обновляет ФИО/семью/пароль и перевыпускает ссылку подтверждения — таймер 24 часа отсчитывается заново.

### Изменения

- **Вход по коду из письма доступен только зарегистрированным пользователям** — запрос OTP на незнакомый email возвращает `user_not_found` (UI предлагает регистрацию), на неподтверждённый — `email_not_verified`. Это закрывает путь, когда случайный клик на кнопку «получить код» создавал «теневой» аккаунт.
- **Вход по паролю** блокируется до подтверждения email.

### Инфраструктура

- В `User` добавлены отдельные поля `firstName`, `lastName`, `middleName` (плюс прежний собранный `name = «Фамилия Имя Отчество»`). Добавлена таблица `email_verification_tokens` с SHA-256 хэшем токена, TTL и `consumedAt`. Для подтверждения email используется env-переменная `WEB_BASE_URL` (с фолбэком на `https://gmd.link28rus.ru`), TTL ссылки настраивается через `EMAIL_VERIFICATION_TTL_SECONDS` (по умолчанию 24 ч).

---

## v0.20.6 — 2026-04-22

### Улучшения

- **Страница входа в едином стиле с главной** — фон страницы входа теперь тоже тёмно-синий с анимированной картой, но линии маршрутов сделаны более извилистыми (двойные S-образные кривые), а четыре GPS-маркера подписаны: «Дом», «Школа», «Секция», «Бабушка». Форма входа переехала в полупрозрачную стеклянную карточку с размытым фоном — видно, что за ней продолжается карта. Кнопки и поля ввода перекрашены в синюю палитру с голубой подсветкой в фокусе и свечением у кнопки «Войти».

---

## v0.20.5 — 2026-04-22

### Улучшения

- **Новый landing на главной странице** — вместо пустого чёрного экрана с текстом «GMD» теперь тёмно-синий фон с картой-подложкой, четырьмя пульсирующими GPS-маркерами по углам и светящимися пунктирными маршрутами между ними. В центре — крупный градиентный логотип, тагляйн и синяя кнопка «Войти» с голубым свечением. Контент появляется плавным fade-up при загрузке.

---

## v0.20.4 — 2026-04-22

### Улучшения

- **Кнопка «Админка» в кабинете больше не красная** — переведена в ту же тёмно-синюю палитру, что и шапка админки. Цвет кнопки совпадает с цветом раздела, куда она ведёт — визуально спокойнее и консистентнее.

---

## v0.20.3 — 2026-04-22

### Улучшения

- **Редизайн админки: тёмно-синяя палитра вместо красной, полностью на русском** — раньше шапка админки была красной, а пункты меню (Dashboard/Users/Families/Children/Invites/Settings) — на английском. Теперь навигация на русском (Обзор / Пользователи / Семьи / Дети / Приглашения / Настройки), шапка — спокойная тёмно-синяя с голубым акцентом активного раздела и точкой-индикатором «режим администратора». Карточки статистики на экране «Обзор» получили иконки и выделенное главное число с вторичными метриками под разделителем — читать быстрее.

---

## v0.20.2 — 2026-04-22

### Улучшения

- **Карта центрируется на выбранном ребёнке** — раньше при клике по ребёнку в списке сайдбара карта оставалась на прежнем месте, и приходилось нажимать кнопку «К ребёнку», чтобы увидеть его. Теперь карта автоматически перемещается к координатам выбранного ребёнка сразу после переключения. Последующие апдейты позиции (каждые 5 секунд) обзор не двигают — чтобы не дёргать карту во время просмотра.

---

## v0.20.1 — 2026-04-22

### Исправления

- **«Ложные» поездки на месте больше не попадают в историю** — если ребёнок полчаса стоит в одной точке, GPS-шум разбрасывает координаты, и это раньше сохранялось как отдельная поездка в истории — «30 мин, 0 м, 134 точки». Теперь сервер при пересчёте отбрасывает такие «стояния»: если за всю поездку ребёнок так и не вышел за радиус остановки (параметр `trip.idle_radius_m` в админке, 100 м по умолчанию), она в историю не попадает. Активная поездка, которая только началась, остаётся видимой на онлайн-карте как и раньше — она не фильтруется. Старые «ложные» поездки автоматически исчезнут при следующем пересчёте (запускается после любого ingest'а или раз в 5 минут по cron'у).

---

## v0.20.0 — 2026-04-22

### Новые возможности

- **Кабинет адаптирован для телефонов и планшетов** — раньше кабинет был рассчитан на десктоп: список детей слева занимал треть экрана, карта съёживалась до нечитаемого состояния, диалоги и карточка статуса ребёнка обрезались по краям. Теперь:
  - На мобильном список детей превратился в выезжающее сбоку меню — открывается круглой кнопкой в левом-верхнем углу поверх карты.
  - Карточка статуса ребёнка переехала вниз экрана и растягивается по ширине — видно всю карту и одновременно батарею/точность/связь.
  - Хедер на узких экранах компактный: логотип остаётся иконкой, пункт «Скачать приложение» переехал в меню профиля, кнопка «Админка» показывается только иконкой.
  - Админка прокручивается горизонтально по nav-пунктам и таблицам (уже было, сохранено).
  - Диалоги подтверждения (удалить ребёнка, отвязать устройство, отправить сигнал, QR-код) перестали обрезаться — подстраиваются под ширину экрана.

### Изменения

- Shared-компонент `ChildrenSidebar` теперь умеет в drawer-режим с backdrop; desktop-поведение не затронуто.
- `ChildStatusCard` — ширина `w-full md:w-[280px]` вместо фиксированных 280 px.
- `Dialog` — `w-[calc(100%-1rem)] max-w-lg`, padding `p-4 sm:p-6`.
- Touch-target кнопки открытия меню — 44×44 px (WCAG).

---

## v0.19.1 — 2026-04-21

### Исправления

- **Локация перестаёт «зависать» после свайпа приложения** — на Xiaomi/MIUI после того, как ребёнок смахивал приложение из списка недавних, телефон переставал присылать новые точки: родитель видел «Был тут 10 минут назад» и больше ничего. Причина — Android замораживал основной поток приложения даже при работающем foreground-сервисе, и планировщик heartbeat'а переставал тикать. Теперь heartbeat тикает через системный AlarmManager с «пробивающим Doze» флагом — тот же механизм, что у будильника. Работает на всех производителях, в том числе на Xiaomi/MIUI с агрессивной экономией батареи.

---

## v0.19.0 — 2026-04-21

### Новые возможности

- **Отправить сигнал ребёнку** — в меню ребёнка появилась кнопка «Отправить сигнал». По нажатию на телефоне ребёнка прозвучит громкий сигнал в течение 2 минут — **даже если звук убавлен до нуля или телефон на беззвучном режиме**. Используется канал будильника (как у «Будильника» в iOS/Android), поэтому DND и Silent не глушат сигнал. Одновременно включается вибрация. Сигнал автоматически выключается через 60 секунд; ребёнок может остановить раньше из уведомления «Остановить».

### Изменения

- Prisma: таблица `device_commands` — доставка команд от родителя к телефону ребёнка. Пока единственный тип — `PLAY_SIGNAL`; далее сюда переедут другие remote-команды (например, «обновить настройки», «запросить свежую точку»).
- Backend: `POST /family/children/:id/commands/signal` (JWT родителя), `GET /child/commands/pending` + `POST /child/commands/:id/ack` (child-токен). Команды живут 5 минут, двойной клик «Сигнал» не плодит очередь — переиспользует существующий pending.
- Mobile-child: `SignalSoundService` (Kotlin, foregroundServiceType=mediaPlayback) — `STREAM_ALARM` на max volume + `MediaPlayer` с дефолтным alarm-рингтоном + вибрация. Ingestor после каждого flush забирает pending-команды — задержка доставки ≤ 2 минут (heartbeat-окно).

---

## v0.18.9 — 2026-04-21

### Изменения

- **Карта ребёнка больше не «прыгает» сама** — раньше карта автоматически центрировалась на ребёнке при каждой новой точке и возвращалась к авто-следованию через 15 секунд после того, как родитель её двигал. Родители жаловались, что карту «выдёргивало» из обзора, пока они рассматривали маршрут. Теперь карта остаётся там, куда её поставил родитель. Чтобы центрировать её на ребёнке — нажмите кнопку со стрелкой-навигатором справа.

---

## v0.18.8 — 2026-04-21

### Новые возможности

- **Согласие на обработку данных 14+ в кабинете** — при привязке устройства к ребёнку 14 лет и старше родитель теперь отмечает согласие прямо в кабинете, в окне генерации QR-кода. Пока галочка не поставлена, кнопка «Создать код» не активна. Телефону ребёнка уже не нужно ничего подтверждать — согласие зафиксировано на стороне родителя.
- Для детей младше 14 лет и без указанной даты рождения процесс привязки не изменился — QR генерируется сразу.

### Исправления

- **fix: привязка ребёнка 14+ больше не падает с ошибкой сервера** — раньше при попытке отсканировать QR для ребёнка 14+ мобильное приложение получало 400 `consent14plus_required`, а в UI отображалось просто «Ошибка сервера». Теперь согласие собирается в веб-кабинете до генерации QR, claim проходит успешно.

### Изменения

- Prisma: `invites.consent14PlusGranted` — флаг согласия, фиксируется при создании invite.
- Backend: `POST /family/children/:childId/invites` принимает `{ consent14PlusGranted: boolean }`. `/child/claim` пропускает проверку `consent14Plus`, если родитель уже дал согласие при создании invite.

---

## v0.18.7 — 2026-04-21

### Исправления

- **Автоматический возврат к сканированию QR после удаления** — раньше, когда родитель удалял ребёнка или сбрасывал устройство, приложение на телефоне ребёнка продолжало думать, что оно привязано. Нельзя было отсканировать новый QR — приходилось переустанавливать приложение. Теперь при открытии приложение проверяет, активен ли токен на сервере. Если нет — показывает сообщение **«Устройство отвязано от семьи. Отсканируй новый QR-код для привязки»** и автоматически возвращает на экран привязки.
- Фоновый сервис тоже реагирует на отзыв токена: при первом же 401/403 от сервера чистит локальный токен и перестаёт слать данные — экономит батарею.

---

## v0.18.6 — 2026-04-21

### Новые возможности

- **История передвижений** — в карточке ребёнка появился пункт меню «История передвижений». На странице истории видны все завершённые поездки за последние 30 дней: время начала и конца, длительность, пройденное расстояние, количество точек. Клик по поездке отрисовывает её маршрут на карте.
- **Онлайн-карта чистится при остановке** — пока ребёнок едет или идёт, на главной карте видна его текущая поездка. Как только он остановится на одном месте дольше 30 минут (параметры настраиваются в админке), линии маршрута пропадают, остаётся только маркер позиции. Карта не захламляется старыми треками.
- **Параметры системы в админке** — новая страница `Settings` в админ-панели. Сейчас там два параметра сегментации поездок: `trip.idle_minutes` (30 мин — сколько ждать остановки) и `trip.idle_radius_m` (70 м — радиус остановки). В будущем туда же будут переезжать другие глобальные константы (retention, throttle и т. п.), без изменений кода.

### Изменения

- Prisma: таблицы `trips` и `app_settings` с дефолтными значениями.
- Backend: `TripSegmenterService` пересчитывает trips после каждого ingest (fire-and-forget). `AppSettingsService` — key-value с 60-сек in-memory кэшем.
- API: `GET /children/:id/trips/active-track`, `GET /children/:id/trips`, `GET /children/:id/trips/:tripId/points`, `GET /admin/settings`, `PATCH /admin/settings/:key`.
- Web: online-карта использует `active-track` вместо суточного `history`.

---

## v0.18.5 — 2026-04-21

### Новые возможности

- **Скачать приложение с главной страницы** — в правом верхнем углу лендинга появилась кнопка «Скачать приложение». Ведёт на страницу `/download`, где можно сразу, без регистрации и входа, скачать актуальную версию приложения ребёнка (для большинства телефонов и 32-битных устройств отдельно). Удобно, если родитель хочет сначала поставить APK на телефон ребёнка, а уже потом регистрироваться в кабинете.

### Изменения

- Добавлены публичные API-эндпоинты `GET /api/public/download` и `GET /api/public/download/{filename}` — без cookie-проверки. Внутренний листинг и скачивание по-прежнему только для авторизованных (`/api/download*`).
- Общая логика листинга/стриминга вынесена в `apps/web/lib/downloads/`.

---

## v0.18.4 — 2026-04-21

### Новые возможности

- **Карта следует за ребёнком автоматически** — на странице ребёнка карта центрируется на его текущем положении и обновляется при каждой новой точке. Если родитель двигает или масштабирует карту, авто-следование приостанавливается на 15 секунд, а потом включается обратно. Рядом с кнопками масштаба появилась кнопка-стрелка для мгновенного возврата к ребёнку.
- **Новый стиль трека** — путь ребёнка теперь рисуется насыщенно-синим пунктиром с кружочком-маркером в каждой точке координат (как на OSM). Раньше линия была полупрозрачной.

---

## v0.18.3 — 2026-04-21

### Новые возможности

- **Защита от свайпа** — если ребёнок (или кто-то из домашних) смахивает приложение из списка «Недавние», фоновый сервис автоматически поднимается обратно через 3 секунды. Раньше при свайпе Android мог окончательно убить процесс — локации переставали идти до следующего открытия приложения или перезагрузки телефона. Теперь трекинг переживает swipe-to-kill на чистом Android; на агрессивных прошивках (Xiaomi/Huawei/Oppo) надёжность зависит от «Автозапуск» в настройках системы.

### Изменения

- Android permissions: добавлено `USE_EXACT_ALARM` (granted автоматически на Android 13+). На Android 12 fallback на `setAndAllowWhileIdle`.
- Android manifest: зарегистрирован `RestartReceiver` для обработки AlarmManager-alarm после `onTaskRemoved`.

---

## v0.18.2 — 2026-04-21

### Новые возможности

- **Имя Wi-Fi сети и мобильного оператора в карточке ребёнка** — метрика «связь» теперь показывает конкретное имя (например «Home WiFi» или «МТС») вместо обобщённого «Wi-Fi / мобильн.». Наглядно видно, в какой сети ребёнок сейчас находится.
- **Индикатор зарядки** — когда телефон заряжается, процент батареи становится зелёным и рядом с иконкой появляется значок молнии ⚡.
- **Heartbeat каждые 2 минуты** — раньше если телефон лежит неподвижно, карточка застывала («Был тут N минут назад» росло бесконечно), потому что Google Fused Location не шлёт точки без смещения 5+ метров. Теперь сервис принудительно досылает текущее положение раз в 2 минуты.

### Изменения

- Prisma: в таблицу `locations` добавлены nullable-поля `wifiSsid` и `mobileOperator`. Retention 30 дней как и у остальных полей.
- Android permissions: добавлены `ACCESS_WIFI_STATE` и `NEARBY_WIFI_DEVICES` (на Android 12+) для чтения SSID.
- 152-ФЗ: SSID — чувствительные данные, нужно актуализировать политику конфиденциальности (отдельная задача).

---

## v0.18.1 — 2026-04-21

### Исправления

- **fix(mobile-child): регистрируем плагины в headless FlutterEngine** — без `GeneratedPluginRegistrant.registerWith(engine)` в фоновом сервисе Drift/path_provider/secure_storage не работали, ingestor молча умирал, локации не отправлялись даже при открытом приложении. Также убран устаревший ручной `src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java`, который затирал автогенерируемый (без path_provider).
- **fix(backend): пересборка Prisma Client без Docker cache** — после деплоя v0.18.0 backend продолжал ходить к старому Prisma Client, ошибка `column locations.networkType does not exist`. Миграция применилась, но образ использовал кешированный слой `prisma generate`.

---

## v0.18.0 — 2026-04-21

### Новые возможности

- **Локации идут в фоне, даже когда приложение закрыто** — фоновый сервис на стороне ребёнка теперь поднимает собственный headless Flutter-изолят и шлёт точки на сервер независимо от того, открыто ли приложение, заблокирован ли экран или только что перезагрузился телефон. Карточка ребёнка больше не застревает на «Был тут 2 часа назад», пока ребёнок не зайдёт в приложение. Батарея и онлайн-индикатор обновляются вместе с локацией.
- **Автозапуск после перезагрузки** — на стороне ребёнка добавлен BootReceiver: после ребута телефона фоновый трекинг поднимается без ручного открытия приложения.
- **Тип сети в карточке ребёнка** — на карточке появилась метрика «связь» (Wi-Fi / мобильная / нет сети). Видно, почему точки задерживаются, если ребёнок в зоне без связи.

### Изменения

- Внутреннее: логика ingestor (очередь Drift + отправка на backend + Connectivity-flush) перенесена из UI-изолята в headless service-изолят — чтобы не было двух Flutter-движков, конкурирующих за одну SQLite.
- Prisma: в таблицу `locations` добавлено nullable-поле `networkType`. Zod-схема ingest принимает `wifi|mobile|offline|unknown`.

---

## v0.17.1 — 2026-04-21

### Новые возможности

- **Действия по ребёнку прямо в карточке на карте** — под метриками появились пункты «Отвязать устройство» и «Удалить ребёнка». Больше не нужно уходить в отдельную плитку для сброса.
- **Неприкреплённый ребёнок — сразу QR для привязки** — если у выбранного ребёнка нет активного устройства, справа вместо пустой карты появляется карточка с кнопкой «Показать QR для привязки» и «Удалить ребёнка». Минимум кликов до привязки.

---

## v0.17.0 — 2026-04-21

### Новые возможности

- **Главная = карта семьи** — открываешь `/cabinet` и сразу видишь слева список детей с аватарами, справа карту выбранного ребёнка со статусом. Не нужно ходить «Главная → Мои дети → Ребёнок → Карта».
- **Хедер в стиле gdemoideti** — логотип «Где мои дети» и навигация слева, справа — «Скачать приложение», красная кнопка «Админка» (только у админов) и аватар-меню профиля с пунктами «Сменить пароль» и «Выйти».
- **Переключение между детьми** — клик по ребёнку слева моментально перерисовывает карту и карточку статусов. Выбранный ребёнок сохраняется в URL `?childId=...` — можно поделиться ссылкой или сохранить в закладки.

### Изменения

- Страница `/cabinet/children` теперь редиректит на `/cabinet` (список + карта схлопнулись в одно).
- Кнопка «Добавить ребёнка» переехала в низ сайдбара со списком детей.
- Старая главная-плитка с большими кнопками (Геозоны, Приложение, Сменить пароль, Выйти) удалена — эти действия доступны из хедера.

---

## v0.16.0 — 2026-04-21

### Новые возможности

- **Аватар-маркер с именем и «был тут N мин назад»** — на карте каждого ребёнка маркер теперь выглядит как цветной кружок с инициалом, под ним — плашка с именем, над ним — плашка с возрастом данных. Цвет детерминированный от имени, так что разные дети сразу отличаются визуально (вдохновлено gdemoideti.ru).
- **Карточка статусов ребёнка** — в левом верхнем углу карты появилась карточка с именем, «был тут N мин назад», батареей, точностью координат и источником (GPS / сеть). Раньше эти данные были размазаны по тонкому нижнему баннеру.

### Изменения

- refactor(web): удалён `StaleIndicator` — его заменила `ChildStatusCard` с полным набором метрик.
- `LatestLocationDto.provider` теперь используется в UI (`GPS` / `сеть`).

---

## v0.15.3 — 2026-04-21

### Новые возможности

- **Баннер на главном экране, если permissions пропали** — если хотя бы одно из критичных разрешений (Локация «Всегда», Работа в фоне, Уведомления) снято, сверху появится красный баннер «Приложение не будет работать в фоне», нажатие ведёт в шаг настроек с MIUI-инструкцией. Проблема заметна сразу, не нужно ждать пока родитель заметит, что точки не приходят.
- Баннер автоматически перепроверяется при возврате из системных настроек (AppLifecycleState.resumed).

---

## v0.15.2 — 2026-04-21

### Исправления

- fix(mobile-child): при заблокированном экране Android Doze усыпляет процесс между GPS-callback'ами, foreground-сервис «жив», но локации не приходят. Теперь сервис удерживает PARTIAL_WAKE_LOCK (+ permission `WAKE_LOCK` в manifest) пока работает — точки летят даже при выключенном экране.
- fix(mobile-child): шаг «Не засыпать» в онбординге теперь подсказывает MIUI-специфичные настройки (Автозапуск, Контроль активности, Экономия энергии) и кнопкой открывает настройки приложения — без этого Xiaomi/Redmi/POCO закрывает сервис независимо от всего остального.

---

## v0.15.1 — 2026-04-21

### Исправления

- fix(mobile-child): при повторном запуске приложение всегда показывало экран «Подключиться», хотя device уже был приклеймлен, и требовало нового QR. Теперь `main.dart` проверяет наличие сохранённого device-token перед рендером — если есть, сразу открывается главный экран, foreground-service стартует и отправка локаций продолжается.

---

## v0.15.0 — 2026-04-21

### Новые возможности

- **Near-realtime трекинг движения** — точка на карте обновляется почти вживую:
  - GPS на устройстве ребёнка теперь раз в 10с (было 30с), минимальное смещение 5м (было 20м).
  - Отправка на сервер — после каждой 2-й точки или раз в 20с (было 5 точек / 3 минуты).
  - Кабинет родителя опрашивает последнюю точку каждые 5с (было 15с), полный трек за сегодня — каждые 10с (было 60с).
  - Backend rate-limit `/child/locations` поднят с 6 до 20 запросов/мин, чтобы новый темп не упирался в throttle.
  - Батарея ребёнка расходуется заметно быстрее — в дальнейшем планируем адаптивный режим (агрессивный когда родитель смотрит на карту, экономный в остальное время).

---

## v0.14.5 — 2026-04-21

### Исправления

- fix(mobile-child): `android/app/build.gradle.kts` имел захардкоженные `versionCode=3, versionName="0.14.1"` — все сборки v0.14.2–4 уходили в APK под одним и тем же манифестом, Android не считал их обновлениями, а в БД для каждого устройства писалось `appVersion: 0.14.1`. Теперь версия берётся из `pubspec.yaml` через `flutter.versionCode`/`flutter.versionName` — bump pubspec автоматически подтягивается в APK.

### Улучшения

- **Точка на карте сразу после привязки** — первая полученная локация отправляется на сервер немедленно (вместо ожидания набора 5 точек / 3 минут). Дальше — стандартный батчинг.

---

## v0.14.4 — 2026-04-21

### Исправления

- fix(backend): ответ `POST /child/claim` не содержал поля `device`, но Dart-клиент приложения ребёнка требовал `json['device']['id']` как обязательное — парсер падал, приложение показывало «Неизвестная ошибка» и не сохраняло device-token, хотя в БД ChildDevice успешно создавался и web-кабинет отображал «Привязано». Теперь backend отдаёт `{deviceToken, child, device:{id}}` — клиент корректно сохраняет токен и продолжает работать.

### Улучшения

- **Версия приложения видна в заголовке экрана** (mobile-child) — на экранах QR-сканера, ручного ввода, разрешений и главном. Теперь при любом баге сразу понятно, какая версия стоит на телефоне.

---

## v0.14.3 — 2026-04-21

### Исправления

- fix(mobile-child): на экране QR-сканера после ошибки `_handled` сбрасывался в `false`, камера тут же детектила тот же QR и отправляла claim снова — ~4 запроса/сек, за 2.5 секунды выжирался rate-limit backend (10 запросов / 10 минут на IP) и дальше всё, включая ручной ввод, получало 429 «Ошибка сервера» на 7 минут. Теперь при ошибке сканирования показываем красный баннер с текстом и кнопку «Попробовать ещё раз» — повторный запрос только по явному жесту пользователя.
- fix(backend): повторная привязка ребёнка после `/reset-device` падала с P2002 (Unique constraint на `ChildDevice.childId`). Индекс глобальный, старые revoked-записи не давали создать новую. Теперь в транзакции claim удаляем ранее revoked-устройства того же ребёнка перед `create` — `/reset-device` → новый QR → `/child/claim` снова работает.

---

## v0.14.2 — 2026-04-21

### Исправления

- fix(mobile-child): приложение ребёнка уходило в connect timeout 10 с при любом запросе (claim-код, отправка локаций, SOS). Дефолтный `API_BASE_URL` был `http://10.0.2.2:3001` — это loopback Android-эмулятора, на реальном телефоне недостижим. Теперь release-build автоматически ходит на `https://gmd.link28rus.ru/api` (HTTPS — работает с любой сети, не зависит от локального IP и cleartext-политики Android). Dev-build через `flutter run` остаётся на `http://10.0.2.2:3001`; оба можно переопределить через `--dart-define=API_BASE_URL=...`.

---

## v0.14.0 — 2026-04-20

### Новые возможности

- **Геозоны** — создайте круговую зону на карте (дом, школа, кружок), назначьте детей, и кабинет автоматически запишет, когда ребёнок зашёл или вышел. До 20 зон на семью, радиус 50–5000 м, палитра из 6 цветов и 8 иконок. Уведомления в мобильном приложении — в следующей фазе.
- **Карта всех зон и лента событий** — на странице «Геозоны» сразу видны круги всех зон семьи, а внизу — хронологический поток «вошла/вышла» по всем детям.
- **Установка и смена пароля в кабинете** — если забыли пароль, войдите по коду из письма, затем в кабинете нажмите «Установить пароль» и задайте постоянный (8–128 символов). Повторно та же кнопка меняется на «Сменить пароль».

### Улучшения

- **Защита от GPS-дрожи** — события «вошёл/вышел» срабатывают только после 60 секунд устойчивого состояния, плюс буферная зона `max(30 м, 15% радиуса)` при выходе — без ложных срабатываний на границе.

### Изменения

- feat(backend): таблицы `zones`, `zone_child_assignments`, `zone_events`, `zone_states` + generated `center_geo geography` + GIST-индекс
- feat(backend): синхронная проверка зон в `POST /child/locations` (PostGIS `ST_DWithin`)
- feat(backend): REST `/zones/*` — CRUD + `/zones/events` лента с cursor-пагинацией
- feat(web): страница `/cabinet/zones` с Яндекс-картой, редактором (адрес + drag-n-drop) и лентой событий
- feat(web): proxy-роуты `/api/zones/*` + типизированный клиент `zonesApi` через `apiFetch`
- feat(web): server-side proxy `/api/geocode` для Yandex Geocoder (ключ только на сервере)
- chore(infra): pg_cron-задачи `zone-events-retention` (30д) и `zones-hard-delete` (30д после soft-delete)
- chore(privacy): bump `PRIVACY_POLICY_VERSION` → 1.1, новый раздел про обработку геозон в политике
- docs: добавлены `docs/database.md`, `docs/legal/privacy-policy-v1.1.md`, `docs/152fz-checklist.md`, обновлён README с возможностями MVP

---

## v0.12.0 — 2026-04-20

### Новые возможности

- **Мониторинг ошибок в кабинете и на сервере** — если в кабинете или на сервере возникает ошибка, админ мгновенно узнаёт об этом через GlitchTip и Telegram-бот (Phase 0.4).
- **Автоматические уведомления о недоступности** — Uptime Kuma следит за доступностью кабинета и API; при падении или проблемах с SSL — пуш в Telegram в течение 2-3 минут.

### Улучшения

- **Регулярные бэкапы GlitchTip и Uptime Kuma** — ежедневные снапшоты + 7-дневный retention; если что-то пойдёт не так — всегда есть откат.

### Изменения

- feat(infra): +5 docker-сервисов (glitchtip-postgres, glitchtip-redis, glitchtip-web, glitchtip-worker, uptime-kuma); наружу порты не светятся — доступ через SSH-туннель.
- feat(backend): `@sentry/node` + `@sentry/nestjs` v9 + PII-scrubbing + фильтр 4xx.
- feat(web): `@sentry/nextjs` v9 + Sentry tunnel через `/api/sentry-tunnel`.
- docs: новый runbook `docs/monitoring.md`.

---

## v0.11.0 — 2026-04-19

### Новые возможности

- **Карта ребёнка в кабинете** — смотрите последнюю позицию ребёнка на Яндекс.Карте с автообновлением раз в 15 секунд. Доступен трек движения за сегодня, вчера, позавчера или любой день в пределах 30 дней. Точность GPS показана окружностью, индикатор устаревания предупредит, если устройство давно не выходило на связь
- **Прямой переход на карту** — на карточке ребёнка в списке появилась кнопка «📍 На карту»

### Изменения

- feat(web): proxy-роуты `/api/children/:id/location/{latest,history}` + типизированный клиент `lib/api/locations`
- feat(web): hooks `useLatestLocation` с visibility-aware polling и `useLocationHistory` с кэшем по дню
- feat(web): хелпер `proxyResponse` корректно проксирует 204 (пустое тело вместо `{}`)
- chore(web): добавлена зависимость `ymap3-components` для Яндекс.Карт v3
- docs(deploy): инструкция по получению ключа Яндекс.Карт

---

## v0.10.0 — 2026-04-19

### Новые возможности

- **Приём GPS-точек от устройства ребёнка** — новый endpoint `POST /child/locations` принимает батчи до 100 точек с device-token. Валидирует clock-skew (±24ч/+2мин), идемпотентен по `(device, recordedAt)`, ограничен 6 запросами в минуту
- **История и текущая позиция ребёнка** — `GET /children/:id/location/latest` отдаёт последнюю точку + `ageSec`; `GET /children/:id/locations?from&to&limit&cursor&order` — пагинированная история с курсором
- **Retention 30 дней** — старые локации удаляются ежедневно в 03:00 UTC через pg_cron; миграция guarded через `pg_available_extensions`, так что тестовые среды без pg_cron не падают

### Изменения

- feat(backend): таблица `locations` с generated `geography(Point,4326)` колонкой + GIST-индекс для будущих геозон
- feat(backend): `FamilyAccessGuard` — переиспользуемый guard проверки доступа родителя к ребёнку. Возвращает 404 `child_not_found` для любого «нет доступа» (анти-enumeration)
- feat(backend): consent-gate на ingest — если владелец семьи не принял текущую политику, приём возвращает 423 `consent_required` с `currentPolicyVersion`; in-memory кэш 60с per childId
- fix(backend): `FamilyAccessGuard` читал `req.user?.sub`, но `JwtAuthGuard` кладёт `req.user.userId` — поймано e2e-тестами

---

## v0.9.0 — 2026-04-19

### Новые возможности

- **Политика конфиденциальности и Пользовательское соглашение** — страницы /privacy и /terms с полными текстами под 152-ФЗ; ссылки в футере всех страниц и под формой входа
- **Журнал согласий пользователя** — каждое принятие политики фиксируется в БД с версией, IP и user-agent для соответствия 152-ФЗ
- **Повторное согласие при обновлении политики** — при bump PRIVACY_POLICY_VERSION в кабинете появляется баннер, мутации блокируются до принятия
- **Согласие за детей от 14 лет** — при подключении устройства ребёнка ≥14 лет требуется флаг consent14Plus в /child/claim (запись CHILD_14PLUS в журнале)

### Изменения

- feat(backend): `ConsentRecord` модель + миграция + `ConsentService` + `ConsentRequiredGuard` на всех мутациях
- feat(backend): `GET /me` расширен `requiresConsent` и `currentPolicyVersion`
- feat(web): `react-markdown` для рендера MD-текстов политики
- feat(web): footer `© 2026 GMD · Политика · Условия` в root layout

---

## v0.8.0 — 2026-04-19

### Новые возможности

- **Вход по паролю** — на странице `/login` появились вкладки «По коду из письма» / «По паролю». Юзер может задать пароль через API (UI управления в Phase 1.4) и входить без ожидания письма
- **Защита от перебора пароля** — после 5 неудач подряд аккаунт блокируется на 15 минут (response 423 `account_locked` с `retryAfterSec`)

### Изменения

- feat(backend): `PasswordService` на argon2id + Redis lock counter
- feat(backend): `POST /auth/login-password`, `POST /auth/set-password` (JwtAuthGuard), `POST /auth/dev/set-password` (защищён `AUTH_DEV_MODE` + `X-Auth-Dev-Secret` для первой установки на self-hosted)
- feat(backend): anti-enumeration — DUMMY_HASH и timing floor 150ms, одинаковый 401 для всех неудач
- chore(backend): поле `User.passwordHash` + миграция `add_user_password_hash`

---

## v0.7.0 — 2026-04-19

### Новые возможности

- **Админ-панель (read-only)** — страница `/admin` с дэшбордом и таблицами: пользователи (+ поиск по email и детали), семьи, дети, активные QR-инвайты. Доступ по email-whitelist через env `ADMIN_EMAILS`
- **Режим администратора в шапке** — если email пользователя в whitelist, в шапке кабинета появляется ссылка «Админка», сам раздел выделен красной полосой сверху
- **Endpoint `GET /me` возвращает `isAdmin`** — клиент знает флаг сразу после входа
- **Dev-флаги входа для self-hosted** — `OTP_FIXED_DEV=XXXXXX` даёт постоянный код входа без SMTP (для ручного смока), `OTP_LOG_DEV=true` пишет сгенерированные коды в логи backend

### Исправления

- **Вход по email/OTP не сохранял сессию на prod** — Caddy проксировал `/api/*` напрямую на backend, обходя Next.js route handlers → httpOnly refresh-cookie никогда не устанавливалась, и после ввода кода пользователя возвращало обратно на `/login`. Caddy теперь маршрутизирует `/api/auth/*`, `/api/me`, `/api/children/*`, `/api/admin/*` через web (#login-fix)
- **Web-контейнер не знал адреса backend** — не было `BACKEND_URL`, Next.js пытался ходить на `127.0.0.1:3001`. Добавлен `BACKEND_URL=http://backend:3001`
- **httpOnly-cookie не работала по HTTP на internal IP** — флаг `Secure` блокировал cookie при доступе через `http://192.168.1.23`. Env `ALLOW_INSECURE_COOKIE=true` временно снимает `Secure` для dev-доступа (на HTTPS не влияет)
- **SMTP с пустым хостом ронял отправку OTP** — теперь SmtpOtpProvider корректно skip-ает отправку если `SMTP_HOST` пустой, вместо падения на connection error

### Изменения

- feat(backend): `AdminGuard` + `ADMIN_CONFIG` на базе env-whitelist, 6 read-only endpoints `/admin/*` (stats, users, families, children, invites)
- feat(web): `/api/admin/*` route handlers как прокси на backend с Bearer, React Query hooks, generic `DataTable` компонент
- chore(backend): `email` добавлен в JWT-payload (нужно для AdminGuard)

---

## v0.6.0 — 2026-04-19

### Новые возможности

- **Управление детьми в кабинете родителя** — страница `/cabinet/children` со списком детей, модалками создания/редактирования/удаления, QR-инвайтом с таймером и сбросом устройства
- **QR-инвайт с обратным отсчётом** — код крупно + QR 240×240, таймер `mm:ss` до истечения, кнопка «Обновить код» перегенерирует invite
- **Бейджи статуса устройства** — «Не привязано» / «Онлайн» (`lastSeenAt < 5 мин`) / «N мин назад» / «N ч назад» / `DD.MM в HH:mm` / «Отозвано»
- **Подтверждение удаления по имени** — чтобы удалить ребёнка, нужно набрать его имя — защита от случайного клика
- **Навигация кабинета** — шапка `/cabinet/*` со ссылками «Главная» и «Мои дети», кнопка «Выйти» в хедере

### Изменения

- chore(web): добавлены зависимости — React Query v5, shadcn/ui (Radix primitives), react-hook-form + Zod, qrcode.react, sonner, lucide-react
- chore(web): Jest + Playwright настроены в web-пакете; добавлены unit-тесты для `useInviteTimer` и `DeviceStatusBadge`
- chore(web): Next.js route-handlers `/api/children/*` как прокси на backend с Bearer-токеном и 401-retry через `/api/auth/refresh`

---

## v0.5.0 — 2026-04-19

### Новые возможности

- **Привязка устройств детей по QR-коду** — родитель создаёт ребёнка в семье и выдаёт одноразовый invite-код (8 символов Crockford Base32, TTL 10 минут) с QR-картинкой
- **Long-lived device-token** — устройство ребёнка после claim получает постоянный токен (32 байта), которым авторизуется в child-API через заголовок `X-Child-Token`
- **Сброс устройства родителем** — `reset-device` отзывает текущий токен и позволяет привязать новое устройство
- **API ребёнка** — `POST /child/claim` (открытый, с rate-limit) и `GET /child/me` (под `ChildAuthGuard`)
- **Web-лендинг `/claim/{code}`** — статическая страница с инструкцией для пользователей

### Изменения

- feat(backend): Prisma models `Child`, `Invite`, `ChildDevice` с soft-delete по `deletedAt`
- feat(backend): модули `children`, `invites`, `child-device` — controller + service + DTO + unit-тесты
- feat(backend): claim использует pessimistic lock (`SELECT ... FOR UPDATE`) для защиты от race condition
- feat(backend): `GET /me` расширен полем `children[]` с eager-loaded device
- test(backend): 77 unit-тестов + 15 e2e через testcontainers, все зелёные
- chore(infra): prod-docker-compose монтирует JWT-ключи и добавляет env-переменные Phase 1.1 (ACCESS_TOKEN_TTL, OTP_*, SMTP_*, PRIVACY_POLICY_*)

---

## v0.4.1 — 2026-04-19

### Новые возможности

- **Web-кабинет: вход по email + OTP** — страницы `/login` и `/cabinet` позволяют родителю войти в систему через браузер; двухстадийная форма (email → 6-значный код → кабинет), silent refresh при F5
- **Защищённый refresh-token в httpOnly cookie** — refresh-token недоступен JavaScript (защита от XSS), access-token в памяти клиента (Zustand)
- **Next.js API-routes как прокси** — клиент не знает адреса backend, нет CORS; все auth-запросы идут через `/api/auth/*`

### Улучшения

- Лендинг `/` — кнопка «Войти» ведёт на `/login`
- `next.config.ts` — `output: 'standalone'` активируется только по `NEXT_STANDALONE=true` (Windows-dev падал на symlinks без admin)

### Изменения

- chore(web): добавлены зависимости `zustand` и `server-only`
- chore(web): `BACKEND_URL` env-переменная для серверной стороны Next.js
- chore(web): `tsconfig` paths `@/* → ./*`

---

## v0.4.0 — 2026-04-18

### Новые возможности

- **Passwordless email-OTP вход** — регистрация и вход одним шагом через `/auth/request-otp` → `/auth/verify-otp` с 6-значным кодом; первая verify автоматически создаёт User + Family + Membership(owner)
- **JWT access + opaque refresh** — RS256 access 15m, 32-byte refresh 30d с rotation on use и replay detection (revoke всей цепочки при reuse)
- **Протектед endpoints** — `GET/PATCH /me`, `PATCH /family/:id` (owner-only), `DELETE /me` (soft-delete per 152-ФЗ) под `JwtAuthGuard`
- **Контекст семьи по умолчанию** — `GET /me` возвращает user + family + memberships одним запросом, не нужно 3 последовательных
- **Rate limiting через Redis** — `@nestjs/throttler` с кастомным `RedisThrottlerStorage`: OTP-request 3/10min, verify 10/10min, refresh/logout 30/min
- **MailHog в dev-стеке** — локальный SMTP + Web UI `http://localhost:8025`, OTP-письма видны в браузере
- **E2E на testcontainers** — 6 тестов на реальном Postgres (postgis/postgis:16-3.4) через `@testcontainers/postgresql`, полный auth-flow + replay detection + rate limit + delete account

### Улучшения

- **Единый формат ошибок** — `{ error: { code, message, details? } }` через глобальный `HttpExceptionFilter`
- **Zod DTO** — все входные endpoints валидируются `ZodValidationPipe`; детали ошибок — массив `{path, message}`
- **Enumeration defense** — `request-otp` всегда `202` + минимальная задержка 200ms против timing-attacks
- **OTP argon2id** — код хранится как argon2id hash + per-code salt, brute-force защищён счётчиком attempts (3 неудачные → код invalidate)
- **Refresh opaque + sha256** — в БД только sha256 от токена, утечка БД не даёт логин

### Изменения

- feat(auth): Prisma models `users`, `families`, `memberships`, `otp_codes`, `refresh_tokens` + миграция `auth_family`
- feat(common): `HttpExceptionFilter`, `ZodValidationPipe`, `RedisThrottlerStorage`
- feat(backend): модули `auth`, `users`, `family` с полным DI через `@Inject`
- chore(deps): `@nestjs/throttler`, `jose`, `@node-rs/argon2`, `nodemailer`, `zod`, `cookie-parser`, `testcontainers`, `@testcontainers/postgresql`
- chore(infra): MailHog в dev-стеке (`docker-compose.dev.yml`)
- chore(web): порт web-приложения 3000 → 3003 (конфликт с параллельным стеком на dev-машине)
- fix(auth): `@Body(ZodPipe)` вместо `@UsePipes` на методах с `@Param` — иначе Zod применяется к path-параметрам
- fix(auth): `@HttpCode(200)` на `verify-otp` и `refresh` (Nest default POST = 201)
- fix(smtp): dev `.env.example` использует `SMTP_HOST=127.0.0.1` — Windows резолвит `localhost` в IPv6, MailHog слушает IPv4

### Security

- **Refresh replay detection** — если клиент прислал уже-rotated token, сервер ревокает **всю цепочку** refresh-токенов этого userId
- **OTP одноразовый + auto-invalidate** — повторный `request-otp` на тот же email инвалидирует предыдущий активный код
- **JwtAuthGuard** — Bearer-only, clock-skew 30s, RS256 асимметричная подпись
- **152-ФЗ** — `acceptedPrivacyPolicyVersion` фиксируется при первой verify, `DELETE /me` → soft-delete + revoke refresh; hard-delete через 30 дней — отдельный cron-job (Phase 1.3)

---

## v0.3.0 — 2026-04-18

### Новые возможности

- **Production-стек на 192.168.1.23** — 6 docker-сервисов (postgres+PostGIS+pg_cron, redis, minio, backend NestJS, web Next.js 15, caddy) поднимаются одной командой `bash infra/deploy/deploy.sh`, все healthy
- **Ежедневные бэкапы БД + weekly restore-verify** — `pg_dump -Fc | zstd -19`, systemd-timer 03:15 MSK, retention 14 daily + 12 monthly, автоматическая проверка целостности в throwaway-контейнере по понедельникам 04:00
- **Автоматическая очистка локаций (152-ФЗ)** — `pg_cron` job `locations_retention_30d` в init-скрипте; реальный schedule активируется после первой Prisma-миграции Phase 1
- **Кастомный образ Postgres** — `gmd-postgres:16-postgis-pgcron` на базе `postgis/postgis:16-3.4` с установленным `postgresql-16-cron`

### Улучшения

- **SSH hardening** — отключена авторизация по паролю, root только по ключу (`PermitRootLogin prohibit-password`), alias `gmd-prod` в `~/.ssh/config`
- **UFW + fail2ban** — default deny incoming, allow 22/80/443; jail sshd с `maxretry=3, bantime=1h`
- **Docker CE + overlay2** — официальный docker.com repo, log-rotation 10MB × 3 в `/etc/docker/daemon.json`
- **Bootstrap-скрипт** — hostname `gmd-prod`, timezone `Europe/Moscow`, swap 4G, `unattended-upgrades`
- **Документация развёртывания** — [deploy.md](docs/deploy.md), [backup-restore.md](docs/backup-restore.md), [server-hardening.md](docs/server-hardening.md)

### Изменения

- feat(infra): Caddy переведён в HTTP-режим (`auto_https off`, site `:80`) — TLS будет терминировать внешний nginx на 95.104.240.96 (Phase 0.4)
- fix(infra): в `pg-restore-verify.sh` задан `cron.database_name=${POSTGRES_DB}`, иначе `CREATE EXTENSION pg_cron` падает при restore
- chore(infra): раздел `/dev/sda2` расширен с 20G до 80G (growpart + resize2fs)
- chore(infra): удалены старые сервисы `fk-norm` и `volleyball-attendance` с предварительным tar-бэкапом
- chore(infra): удалён native PostgreSQL 16 и Node.js (оставлены только контейнеризованные версии)

### Отложено на Phase 0.4

- GlitchTip self-hosted + Sentry SDK в backend/web — нужен внешний TLS и subdomain `errors.gmd.link28rus.ru`
- Uptime Kuma + мониторы — нужен внешний TLS и subdomain `status.gmd.link28rus.ru`
- Let's Encrypt на самом Caddy — сейчас TLS выпускается на внешнем nginx

---

## v0.2.0 — 2026-04-18

### Новые возможности
- **Docker dev-стек** — `pnpm stack:up` поднимает PostgreSQL 16 + PostGIS, Redis 7, MinIO, Adminer одной командой
- **Prisma-миграции работают** — первая миграция применена к живой БД, таблица `users` создана
- **Readiness-проба** — новый эндпоинт `GET /readyz` возвращает `{status, db, redis}` и реально пингует БД и Redis
- **PrismaService + RedisService** — NestJS-модули с lifecycle-хуками (`OnModuleInit` / `OnModuleDestroy`)
- **Bucket `gmd-uploads`** — создаётся автоматически one-shot `minio-setup` контейнером при старте стека

### Улучшения
- **Скрипты стека** — `stack:up/down/logs/ps/reset` в root `package.json`
- **Документация** — CLAUDE.md и README описывают dev-команды, порты и сценарий конфликтов портов

### Изменения
- chore(infra): docker-compose.prod.yml скелет с TODO (наполняется в Phase 0.3)
- chore(backend): `.env.example` обновлён (REDIS_URL + корректный пароль Postgres)
- fix(infra): minio переведён на `minio/minio` (bitnami/minio удалён с Docker Hub)
- fix(backend): `@Inject()` в HealthController, чтобы ESLint `consistent-type-imports` не превращал DI-провайдеры в `import type` и не ломал DI в рантайме

---

## v0.1.0 — 2026-04-18

### Изменения
- **Монорепо-скелет** — pnpm workspaces + Turborepo для JS/TS, Melos для Flutter
- **Backend** — NestJS 11 skeleton с `/healthz`, Prisma 5 (заглушечная модель User)
- **Web** — Next.js 15 skeleton с landing-заглушкой и `/api/healthz`
- **Mobile** — Flutter-приложения `mobile-parent` (Android+iOS) и `mobile-child` (Android); Dart-пакеты `gmd_parent`, `gmd_child`, `gmd_shared`
- **Пакеты** — `@gmd/shared-types`, `@gmd/ui` (заглушки)
- **Тулинг** — ESLint 9 flat config, Prettier 3, Husky 9 + lint-staged, commitlint (Conventional Commits)
- **fix(ui): `--no-error-on-unmatched-pattern`** — lint-скрипт пакета `@gmd/ui` не падает, если `src/**/*.tsx` пока пуст
- **Дизайн MVP** — см. [spec](docs/superpowers/specs/2026-04-18-gmd-mvp-design.md)
- **CLAUDE.md** — конвенции, скилы, субагенты, процесс

---

<!-- Шаблон записи релиза — раскомментировать при выпуске первой версии

## v0.1.0 — 2026-MM-DD

### Новые возможности
- **Название фичи** — человекочитаемое описание, что даёт пользователю (#PR)

### Улучшения
- **Короткое название** — что стало лучше (#PR)

### Исправления
- fix(scope): краткое описание починенного бага (#PR)

### Изменения
- docs: обновления документации
- refactor: техдолг без влияния на пользователя

-->
