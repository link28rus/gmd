# GMD Phase 3 — mobile-child Flutter (design)

**Дата:** 2026-04-20
**Фаза:** 3
**Предшественник:** v0.12.0 (Phase 0.4 — мониторинг)
**Релизная цель:** v0.13.0

## 1. Область и не-область

### Что входит

- Flutter-приложение `apps/mobile-child` (Android-only на MVP).
- **Claim** по QR-коду + fallback на ручной ввод 6-значного кода.
- **Фоновый GPS** через нативный Kotlin foreground service + `FusedLocationProviderClient`.
- **Drift offline queue** + batch-upload на существующий `POST /child/locations`.
- **SOS**-кнопка → новый `POST /sos` endpoint + FCM-push родителю.
- **Ring**-команда от родителя через FCM → громкий сигнал на `STREAM_ALARM` (обходит беззвучный режим).
- **Anti-uninstall** через Android Device Admin (`DeviceAdminReceiver`).
- Permissions wizard: уведомления / локация / battery opt / device admin.
- CI: `flutter analyze` + `flutter test` + `flutter build apk --debug` на PR.

### Что НЕ входит (отложено в следующие фазы)

- **Геозоны + push при входе/выходе** — Phase 4.
- **FCM-команда «locate now»** (принудительное обновление позиции) — Phase 4.
- **RuStore Push** как fallback для устройств без GMS — Phase 4.
- **«Звук вокруг» / live listen** (запись микрофона с передачей родителю) — Phase 5. Требует отдельного consent-слоя, Privacy Policy v2, уведомления Роскомнадзору по биометрическим ПДн.
- **App blocker + screen-time** (Accessibility Service, UsageStatsManager, расписания) — Phase 6.
- **iOS mobile-child** — вне MVP.
- Parent-side UX для SOS/Ring — в Phase 3 только сам endpoint и short-polling для web-кабинета. Полноценный UI — вместе с Phase 2 (геозоны) или позже.

## 2. Архитектура

```
┌───────────────────────────────────────────────────────────────┐
│  mobile-child (Flutter + Kotlin)                               │
│                                                                │
│  ┌───────────────────┐         ┌──────────────────────────────┐│
│  │   Flutter (Dart)  │         │  Native (Kotlin)             ││
│  │  - UI (claim /    │         │  - LocationForegroundService ││
│  │    home / sos)    │ ◄──MC─► │    (FusedLocationProvider)   ││
│  │  - Riverpod state │         │  - GmdDeviceAdminReceiver    ││
│  │  - Dio HTTP       │         │  - RingService               ││
│  │  - Drift queue    │         │    (MediaPlayer STREAM_ALARM)││
│  │  - FCM handler    │         │                              ││
│  └───────────────────┘         └──────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
          │                                  │
          │ HTTPS                            │ FCM push
          ▼                                  ▼
  ┌─────────────────┐                ┌─────────────────┐
  │  Backend API    │                │  Firebase FCM   │
  │  (existing)     │                │                 │
  └─────────────────┘                └─────────────────┘
```

**Принцип разделения:** Flutter несёт всю UX и бизнес-логику клиентского уровня (claim flow, queue management, API-клиенты, Riverpod). Kotlin — только системные обязанности, которые требуют нативного API: foreground service с gps, device admin, mediaplayer с принудительным volume. Общение — через `MethodChannel`.

## 3. Стек и пакеты

### Flutter (`apps/mobile-child/pubspec.yaml`)

| Пакет                                          | Минимальная версия | Назначение                                          |
| ---------------------------------------------- | ------------------ | --------------------------------------------------- |
| `flutter_riverpod`                             | ^2.6.0             | State management                                    |
| `dio`                                          | ^5.7.0             | HTTP client + interceptors                          |
| `drift` + `drift_dev` + `sqlite3_flutter_libs` | ^2.20.0            | Локальный SQLite                                    |
| `flutter_secure_storage`                       | ^9.2.0             | device-token, chilId (Encrypted Shared Preferences) |
| `firebase_core`                                | ^3.x               | Firebase runtime                                    |
| `firebase_messaging`                           | ^15.x              | FCM receive                                         |
| `mobile_scanner`                               | ^5.x               | QR-скан при claim                                   |
| `permission_handler`                           | ^11.x              | Unified permissions UX                              |
| `geolocator`                                   | ^13.x              | Dart-слой получения точек для UI (не background)    |
| `connectivity_plus`                            | ^6.x               | Online/offline сигнал для flush'а очереди           |
| `device_info_plus`                             | ^11.x              | `osVersion` для claim                               |
| `package_info_plus`                            | ^8.x               | `appVersion` для claim                              |
| `go_router`                                    | ^14.x              | Декларативная навигация                             |
| `freezed` + `json_serializable` (dev)          | latest             | Codegen для DTO                                     |

### Native Kotlin (`apps/mobile-child/android/app/build.gradle.kts`)

```kotlin
implementation("com.google.android.gms:play-services-location:21.3.0")
implementation("com.google.firebase:firebase-messaging-ktx:24.0.0")
// DeviceAdmin, MediaPlayer, AudioManager — встроены в Android SDK
```

### Shared-packages

- `packages/shared-dart` — OpenAPI-сгенерированные Dart DTO (`ClaimDto`, `LocationBatchDto`, `SosDto`, `RingCommandDto`, `ChildDeviceResponse`).
- Регенерация после backend-изменений: `pnpm --filter @gmd/backend openapi:generate && pnpm --filter @gmd/shared-dart build`.

### Android target

- `minSdkVersion = 26` (Android 8) — нужен для foreground service types + современного WorkManager.
- `targetSdkVersion = 34` (Android 14) — требование Play Store.
- `compileSdkVersion = 34`.
- В `AndroidManifest.xml` у `<service android:name=".LocationForegroundService">` обязательный атрибут `android:foregroundServiceType="location"` (Android 10+) + permission `FOREGROUND_SERVICE_LOCATION` (Android 14+).

## 4. Модель данных (локально на устройстве)

```dart
// apps/mobile-child/lib/data/database.dart

@DriftDatabase(tables: [PendingLocations, AppSettings, AuditLogs])
class AppDatabase extends _$AppDatabase { ... }

class PendingLocations extends Table {
  IntColumn get id => integer().autoIncrement()();
  RealColumn get lat => real()();
  RealColumn get lon => real()();
  RealColumn get accuracy => real().nullable()();
  RealColumn get altitude => real().nullable()();
  RealColumn get speed => real().nullable()();
  RealColumn get bearing => real().nullable()();
  IntColumn get batteryLevel => integer().nullable()();
  BoolColumn get isCharging => boolean().nullable()();
  TextColumn get provider => text().nullable()();
  DateTimeColumn get recordedAt => dateTime()();
  IntColumn get uploadAttempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get lastAttemptAt => dateTime().nullable()();
}

class AppSettings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();
  @override Set<Column> get primaryKey => {key};
}
// Keys: familyId, childId, childName, deviceId, lastClaimAt, fcmToken, fcmTokenUploadedAt

class AuditLogs extends Table {
  // События «пришёл ring», «отправлен SOS», «claim успешен», «permission отклонена».
  // Ограничение: хранить последние 200 событий, покрутить ring buffer.
  IntColumn get id => integer().autoIncrement()();
  TextColumn get event => text()();      // e.g. "ring_received"
  TextColumn get details => text().nullable()();  // JSON
  DateTimeColumn get at => dateTime()();
}
```

**device-token** и любые другие секреты хранятся ТОЛЬКО в `flutter_secure_storage` (EncryptedSharedPreferences на Android). В Drift — никаких секретов.

## 5. Поток геолокации (end-to-end)

### Kotlin side

```
LocationForegroundService (Service)

  onStartCommand:
    startForeground(NOTIF_ID, buildPersistentNotification())
    fusedClient.requestLocationUpdates(
      LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 30_000)
        .setMinUpdateDistanceMeters(20f)
        .setMinUpdateIntervalMillis(15_000)
        .build(),
      callback = ::onLocationResult,
      mainLooper
    )

  onLocationResult(result: LocationResult):
    for (loc in result.locations) {
      channel.invokeMethod("onLocation", mapOf(
        "lat" to loc.latitude, "lon" to loc.longitude,
        "accuracy" to loc.accuracy,
        "altitude" to loc.altitude.takeIf { loc.hasAltitude() },
        "speed" to loc.speed.takeIf { loc.hasSpeed() },
        "bearing" to loc.bearing.takeIf { loc.hasBearing() },
        "batteryLevel" to batteryManager.getIntProperty(...),
        "isCharging" to batteryManager.isCharging,
        "provider" to loc.provider,
        "recordedAt" to loc.time,
      ))
    }

  onDestroy:
    fusedClient.removeLocationUpdates(callback)
    stopForeground(STOP_FOREGROUND_REMOVE)
```

### Dart side

```
LocationIngestor (Riverpod provider, auto-keep-alive)

  методы:
    - init() — регистрирует MethodChannel handler, запускает сервис
    - _onLocation(payload) — вставляет в Drift PendingLocations
    - _maybeFlush() — если очередь ≥ 5 или age последнего flush > 3 мин → flushQueue()
    - flushQueue() — выбирает до 100 из очереди, POST batch, обрабатывает ответы
    - dispose() — shutdown foreground service

  flushQueue():
    batch = db.select(pendingLocations)
              ..where((t) => t.uploadAttempts.isSmallerThan(5))
              ..limit(100)

    try:
      resp = dio.post('/child/locations', data: batch.toJson())
      db.pendingLocations.deleteWhere(id in resp.acceptedIds)
      if resp.rejected != null:
        // out_of_window, invalid → дропаем навсегда
        db.pendingLocations.deleteWhere(id in resp.rejectedIds)
    catch (DioException e):
      if e.response.statusCode in 400..499:
        drop batch (bad payload, не повторится)
      else:
        markRetry(batch) // uploadAttempts++, lastAttemptAt = now
```

### Параметры (tuneable через AppSettings)

- GPS interval: 30 сек baseline, 15 сек при активной SOS-сессии, 60 сек при battery < 15%
- Batch flush: каждые 5 точек ИЛИ 3 минуты
- Max queue size: 10 000 точек (~7 часов без сети). При переполнении — drop oldest.
- Retry policy: exp backoff, max 5 attempts, затем drop с логом в AuditLogs.

### Persistent notification (foreground service)

- Title: **«GMD — подключено к семье»**
- Text: **«Маме/папе видно твоё местоположение»**
- Icon: GMD-лого (single-color ваше white для Android statusbar convention)
- `setOngoing(true)` + `setPriority(LOW)` — невозможно свайпнуть, не вибрирует
- Tap → открывает `/home`

### Battery-hygiene

- На финальном шаге onboarding запрашиваем `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` Intent.
- Если отказано — баннер на главном экране «Для стабильной работы разреши фоновую активность» с deep-link в Settings.
- Connectivity-listener (`connectivity_plus`): при transition `none → wifi/mobile` немедленный `flushQueue()` вне расписания.

## 6. UI-экраны

### Структура (GoRouter routes)

```
/                       → /onboarding (если не было claim) | /home
/onboarding             — приветствие + кнопка «Подключиться»
/claim                  — камера, QR-скан
/claim/manual           — 6-ячеечный OTP ввод
/permissions/:step      — wizard 4-х шагов (notif, loc, battery, devadmin)
/home                   — главный экран (статус + SOS)
/ring                   — overlay поверх home при входящем ring
/settings               — о приложении, версия, логи
```

### Onboarding → Claim flow

1. `/onboarding` — «Привет! Это GMD. Нужно подключиться к семье.» [Подключиться]
2. `/claim` — камера активна, crosshair. Кнопка «Ввести код вручную».
3. QR распознан → `POST /child/claim` с `{ code, deviceName, osVersion, appVersion, consent14Plus }`.
   - `consent14Plus` = true только если на предыдущем шаге показали чекбокс с согласием 14+ (для детей старше 14, иначе опускаем/ставим null).
4. Ответ → сохраняем device-token в `flutter_secure_storage`, остальное в `AppSettings`.
5. Переход в `/permissions/notifications`.

### Permissions wizard

| Шаг | Permission                                            | Копирайт                                                                                      | Можно skip?                                        |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `POST_NOTIFICATIONS` (Android 13+)                    | «Маме/папе нужно знать, если что-то случится»                                                 | Да, но warning banner в /home                      |
| 2   | `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` | «Чтобы видеть где ты, даже когда приложение закрыто»                                          | Да, но сервис не запустится                        |
| 3   | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`                | «Чтобы приложение не засыпало»                                                                | Да, но предупреждение «может работать нестабильно» |
| 4   | `DeviceAdmin` (ACTION_ADD_DEVICE_ADMIN Intent)        | «Защита от случайного удаления. Мама/папа получит уведомление, если ты попытаешься отключить» | Да, но опционально                                 |

После wizard'а — старт foreground-service + `GoRouter.go('/home')`.

### Главный экран `/home`

```
┌─────────────────────────────────┐
│  Привет, Олег!                   │
│  Ты подключён к семье            │
│                                  │
│  🟢 Связь с домом есть            │
│  📍 Точка отправлена 14:23        │
│                                  │
│                                  │
│        ┌───────────┐              │
│        │           │              │
│        │    SOS    │              │
│        │           │              │
│        └───────────┘              │
│                                  │
│  [Позвонить маме]  [Позвонить папе]│
│                                  │
│  ─────────────────────           │
│  Настройки · О приложении         │
└─────────────────────────────────┘
```

- Если какие-то permissions не даны — вверху warning banner с кнопкой «Настроить».
- «Позвонить маме/папе»: `tel:` intent с номерами из `GET /child/me`. Если бэкенд не отдаёт телефоны родителей (Phase 1.1 не хранит) — пункт открывает экран «Попросите маму настроить в кабинете» как placeholder.

### SOS UX

1. Long-press кнопки 2 секунды (защита от случайного тапа).
2. Появляется confirmation: «Отправить SOS? Отменить через 3…2…1» (3 сек).
3. Если не отменил → `POST /sos` с текущей последней точкой.
4. Confirmation «Помощь идёт 💚» + короткая вибрация.
5. Переключение GPS interval на 15 сек на следующие 30 мин.

### Ring overlay `/ring`

- При получении FCM `{type: "ring"}` — Kotlin-side сразу стартует `RingService` (MediaPlayer + volume-up), параллельно отправляет high-priority system-notification с `fullScreenIntent` на `MainActivity?route=/ring`. При активном приложении — Dart-handler просто делает `GoRouter.go('/ring')`.
- Красный фон, иконка GMD, текст «Мама/папа зовут тебя!», крупная кнопка «Я здесь».
- Тап на кнопку → `RingService.stop()` в Kotlin, запись в AuditLogs, возврат на `/home`.

## 7. API-контракты

### Существующие (не трогаем)

- `POST /child/claim` — обмен кода на device-token (Phase 1.2).
- `GET /child/me` — инфо ребёнка (Phase 1.2).
- `POST /child/locations` — batch-ingestion (Phase 1.3).

### Новые в Phase 3

#### 7.1 Регистрация FCM-токена

```
POST /child/device/push-token
Auth: ChildAuthGuard (device-token)
Body: { platform: "fcm", token: string (max 4096 chars) }
Response 200: { ok: true }
```

Prisma:

```prisma
model ChildDevice {
  // ...existing fields
  fcmToken          String?
  fcmTokenUpdatedAt DateTime?
}
```

Миграция: `add-fcm-token-to-child-device`.

Вызывается клиентом:

- После получения FCM-токена впервые (после successful claim + granted notifications permission).
- На `FirebaseMessaging.onTokenRefresh`.
- На app launch (no-op если checksum не изменился — проверка на клиенте).

#### 7.2 SOS-событие от ребёнка

```
POST /sos
Auth: ChildAuthGuard
Body: {
  lat: number,
  lon: number,
  accuracy?: number,
  recordedAt: ISO8601,
  message?: string (max 500 chars)
}
Response 200: { sosId: string, createdAt: ISO8601 }
Rate-limit: 3 в 5 минут на устройство
```

Prisma:

```prisma
model SosEvent {
  id              String   @id @default(cuid())
  childId         String
  childDeviceId   String
  lat             Float
  lon             Float
  accuracy        Float?
  recordedAt      DateTime
  serverCreatedAt DateTime @default(now())
  message         String?  @db.VarChar(500)
  acknowledgedAt  DateTime?
  acknowledgedBy  String?

  child       Child       @relation(fields: [childId], references: [id], onDelete: Cascade)
  childDevice ChildDevice @relation(fields: [childDeviceId], references: [id], onDelete: Cascade)

  @@index([childId, serverCreatedAt(sort: Desc)])
  @@map("sos_events")
}
```

Backend при получении:

1. Сохраняет событие.
2. Для всех parent'ов в семье шлёт FCM (data-only) `{ type: "sos", sosId, childId, lat, lon, recordedAt }`.
3. Дублирует в email (SMTP-канал Yandex уже настроен в Phase 0.4).

#### 7.3 Short-polling для web-кабинета

```
GET /family/sos?since=ISO8601
Auth: JwtAuthGuard (parent)
Response 200: { events: SosEvent[] }
```

Web-кабинет в Phase 3 опрашивает этот endpoint каждые 30 сек (placeholder до полноценной Phase 4 UX).

#### 7.4 Ring-команда от родителя

```
POST /children/:childId/ring
Auth: JwtAuthGuard + FamilyAccessGuard
Body: { duration?: number (seconds, default 60, max 180) }
Response 200: { dispatched: true, devices: number }
Rate-limit: 5 в 10 минут на одного ребёнка
```

Backend:

1. Валидирует доступ родителя к childId через `FamilyAccessGuard`.
2. Извлекает все `ChildDevice.fcmToken` для childId.
3. Отправляет data-only FCM на каждый токен:

```json
{
  "data": {
    "type": "ring",
    "duration": "60",
    "initiatedAt": "2026-04-20T10:33:00Z"
  },
  "android": { "priority": "high", "ttl": "60s" }
}
```

4. Audit-логгирование:

```prisma
model RingEvent {
  id            String   @id @default(cuid())
  childId       String
  initiatedBy   String   // parent userId
  duration      Int
  dispatchedAt  DateTime @default(now())
  deviceCount   Int
  fcmResponse   Json?

  child Child @relation(fields: [childId], references: [id], onDelete: Cascade)

  @@index([childId, dispatchedAt(sort: Desc)])
  @@map("ring_events")
}
```

#### 7.5 Мониторинг `lastSeenAt`

- `ChildDevice.lastSeenAt` обновляется interceptor'ом на каждый успешный `/child/locations` и `/child/me`.
- `GET /children/:id` (parent) возвращает `lastSeenAt`, web/mobile-parent показывает индикатор «Связь потеряна» если > 2h.
- Не требует нового endpoint'а, уточнение существующего response-shape.

### OpenAPI

- Обновляем `docs/openapi.yaml`, регенерируем клиенты:

```bash
pnpm --filter @gmd/backend openapi:generate
pnpm --filter @gmd/shared-types build
pnpm --filter @gmd/shared-dart build
```

## 8. Firebase / FCM setup

- Создать Firebase-проект `gmd-mobile-prod` (аккаунт — dedicated Google-account, не `link28rus@gmail.com` чтобы не мешать с Yandex SMTP; решение в M4).
- Android app `ru.link28rus.gmd.child`, скачать `google-services.json` → `apps/mobile-child/android/app/google-services.json` (в git не коммитим, в `.gitignore`).
- На backend — service-account JSON для Admin SDK, хранить в `/opt/gmd/.env.prod` как `FCM_SERVICE_ACCOUNT_JSON` (base64-encoded).
- Для dev — отдельный Firebase-project `gmd-mobile-dev` или один prod-project с флагом `_debug`.

## 9. Anti-uninstall (Device Admin)

### Реализация

```kotlin
// GmdDeviceAdminReceiver.kt
class GmdDeviceAdminReceiver : DeviceAdminReceiver() {
  override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
    return "Если ты выключишь защиту, мама/папа не смогут тебя найти в случае опасности."
  }
}
```

```xml
<!-- res/xml/device_admin.xml -->
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-policies>
    <!-- минимальные политики, только чтобы активировать Device Admin -->
  </uses-policies>
</device-admin>
```

```xml
<!-- AndroidManifest.xml -->
<receiver
    android:name=".GmdDeviceAdminReceiver"
    android:permission="android.permission.BIND_DEVICE_ADMIN"
    android:exported="true">
  <meta-data
      android:name="android.app.device_admin"
      android:resource="@xml/device_admin" />
  <intent-filter>
    <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
  </intent-filter>
</receiver>
```

### UX

- На шаге `/permissions/devadmin` — интент `ACTION_ADD_DEVICE_ADMIN` с `EXTRA_DEVICE_ADMIN` и `EXTRA_ADD_EXPLANATION = "Защита от удаления. Мама/папа получит уведомление, если ты попытаешься выключить."`.
- Android показывает системный диалог — ребёнок жмёт «Активировать».
- Если отказано — помечаем в AppSettings `deviceAdminDeclined=true`, баннер на `/home`.

### Google Play permission declaration

- В Play Console при upload APK — обоснование: **Parental control app for monitoring minors with explicit parent+child consent**.
- Прикрепить демо-видео флоу claim'а + consent-UX.
- Ссылаться на Privacy Policy + EULA (уже есть в Phase 1.2.5).

### Ограничения

- Ребёнок может обойти через «Настройки → Security → Device admin apps → деактивировать GMD → удалить» — это двухшаговая преграда, достаточная для 8-12 лет.
- Отдельный endpoint «device admin снят» не делаем — мониторим через `lastSeenAt` с алертом родителю.

## 10. Тестирование

### Пирамида

| Уровень            | Покрытие                                                                   | Инструмент                  |
| ------------------ | -------------------------------------------------------------------------- | --------------------------- |
| Unit (Dart)        | DTO parsing, queue logic, retry policy, battery tiers, consent conditional | `flutter_test`              |
| Widget (Dart)      | Экраны claim, permissions wizard, home, ring overlay                       | `flutter_test` + `mocktail` |
| Integration (Dart) | Claim E2E против mock HTTP + mock MethodChannel                            | `integration_test`          |
| Backend (Jest)     | SOS endpoint, ring endpoint, push-token endpoint, FCM mock                 | Jest + supertest            |
| Manual QA          | Реальные устройства                                                        | —                           |

### Backend TDD

Все новые endpoints (`POST /child/device/push-token`, `POST /sos`, `GET /family/sos`, `POST /children/:childId/ring`) — TDD. Сначала supertest-specs, затем реализация. Контракт: status-коды, body, rate-limits, auth, FCM mock-call.

### Flutter TDD

- LocationIngestor — unit-тесты на retry policy + queue overflow + battery tier transitions.
- Dio interceptor — refresh-device-token behavior (нет refresh для device-token, но должен корректно дропать 401 и показывать exit-screen «переподключите устройство»).

### Manual QA matrix

| Устройство        | API   | OEM          | Обязательно |
| ----------------- | ----- | ------------ | ----------- |
| Pixel 6 / 7       | 14    | Google stock | ✅          |
| Samsung A-series  | 13/14 | OneUI        | ✅          |
| Xiaomi Redmi Note | 13    | MIUI         | ✅          |
| Realme / Oppo     | 14    | ColorOS      | 🟡          |

### Battery benchmark

- **Сценарий:** Pixel, свежая батарея 100%, WiFi+GPS включены, ребёнок-устройство лежит статично 8 часов с открытым приложением в фоне.
- **Метрика:** battery drop ≤ 15% (из MVP spec).
- **Инструмент:** `adb shell dumpsys batterystats` до/после.

## 11. Success criteria

1. Claim E2E на новом устройстве < 90 сек (QR-flow).
2. Battery drop ≤ 15% за 8h background GPS (Pixel baseline).
3. 30 минут без сети → все точки сохранены в Drift и отправлены после восстановления.
4. SOS: от нажатия до появления в БД и FCM-delivery на parent — < 5 сек (нормальная сеть).
5. Ring: от `POST /children/:id/ring` до начала проигрывания — < 10 сек в 95% случаев.
6. Anti-uninstall: long-press «удалить» блокируется, требует явного отключения Device Admin.
7. Все permissions screens можно skip с warning-баннером и ограниченной функциональностью.

## 12. Milestones

```
M1. Flutter skeleton (1 сессия)
    - pnpm/melos workspace hookup
    - GoRouter + Riverpod + Dio + Drift boilerplate
    - flutter_secure_storage + shared-dart wiring
    - CI: flutter analyze + test

M2. Claim flow (1 сессия)
    - /onboarding + /claim (QR scan)
    - /claim/manual fallback
    - Dio client + claim API call + device-token persistence
    - Widget tests

M3. Native foreground service (1-2 сессии)
    - Kotlin LocationForegroundService + FusedLocationProvider
    - MethodChannel bridge (Kotlin → Dart)
    - Dart LocationIngestor + Drift queue
    - Permissions wizard UI (4 шага)
    - POST /child/locations integration

M4. FCM + Ring (1 сессия)
    - Firebase project setup
    - google-services.json подключение
    - POST /child/device/push-token (backend + client)
    - POST /children/:childId/ring (backend TDD)
    - Kotlin RingService (MediaPlayer STREAM_ALARM)
    - Ring overlay UI

M5. SOS (0.5 сессии)
    - POST /sos (backend TDD + FCM mock)
    - GET /family/sos (polling)
    - SosEvent Prisma model + migration
    - Long-press UI + confirmation

M6. Anti-uninstall (0.5 сессии)
    - GmdDeviceAdminReceiver + device_admin.xml
    - Permissions wizard step
    - Документация для Play Console permission declaration

M7. QA pass + release (1 сессия)
    - Manual matrix на 3 OEM
    - Battery benchmark 8h на Pixel
    - Release APK signing + keystore setup
    - CHANGELOG + tag v0.13.0
```

**Общий объём:** ~5–6 сессий, ~2 недели.

## 13. Риски

| Риск                                                   | Вероятность | Митигация                                                                                                    |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| OEM-killer убивает foreground service на Xiaomi/Huawei | высокая     | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` запрос + документация «разрешить autostart» + мониторинг `lastSeenAt` |
| FCM delivery delay > 10 сек на Xiaomi/Honor            | средняя     | Phase 4 добавит RuStore Push fallback; в Phase 3 — принимаем                                                 |
| Drift breaking change между major-версиями             | низкая      | Lock в pubspec.lock, обновление только вместе с phase-bump                                                   |
| Play review отклонит Device Admin                      | средняя     | Permission declaration по шаблону Google «Family policy, parental control», demo-видео onboarding'а          |
| Firebase требует выделенного Google-account            | высокая     | В M4 завести отдельный аккаунт `gmd-mobile@...`, credentials в memory-compiler (secret)                      |

## 14. Обратная совместимость и миграции

### Backend

- Новые таблицы (`sos_events`, `ring_events`) + новые nullable поля в `child_devices` — additive миграция, zero-downtime.
- `POST /child/locations` — не меняем формат.
- `ChildAuthGuard` переиспользуется для `/child/device/push-token` и `/sos`.

### Flutter

- Первая версия клиента — нет предыдущей для migrate from.
- Drift schema version 1, `onCreate` fresh.

## 15. Документация и CHANGELOG

- `CHANGELOG.md` запись v0.13.0 по конвенции CLAUDE.md (новые возможности, улучшения, техчейнджи).
- Пополнить `docs/api.md` описанием новых endpoints (или автогенерация из OpenAPI если инфра есть).
- `docs/mobile-child.md` — setup-инструкция разработчику: flutter + melos + firebase config + keystore.
- Обновить `CLAUDE.md` → открытые вопросы: закрыть «Riverpod vs Bloc» (решено: Riverpod).

## 16. Открытые вопросы к реализации

1. **Firebase-аккаунт** — новый Google account для `gmd-mobile-prod` — создать в M4.
2. **Родительские телефоны в claim-response** — бэкенд сейчас не хранит phone родителей. Решение: либо добавить optional `profile.phone` в Phase 3 (small change), либо placeholder «Попросите маму настроить» в UI mobile-child. Решим в M2.
3. **Git remote** — остаётся долг из Phase 0.4. Без remote нельзя настроить CI (долг №1). Нужно решение до M1 (GitHub private vs Gitea).
4. **Keystore для release APK** — сгенерировать в M7, положить `.jks` в `/opt/gmd/` на prod-сервере, пароли в memory-compiler.
5. **Privacy Policy patch** — v1 из Phase 1.2.5 не упоминает SOS-события и ring-команды как процессинг ПДн. Нужен minor patch (v1.1) в M5–M6: явно описать, что (а) местоположение из SOS-события сохраняется с меткой «тревога», (б) ring-команды логируются в `ring_events`. Обновление — через существующую consent-механику Phase 1.2.5, повторное согласие не требуется (same-category processing).
