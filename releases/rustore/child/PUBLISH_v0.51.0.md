# Публикация child v0.51.0(6088) в RuStore — инструкция

> **TL;DR:** залить AAB по адресу ниже, скопипастить три блока текста в wizard, нажать «Отправить на модерацию». Multi-use invite уже настроен на проде, модератор сможет тестировать неограниченное число раз. Backend переехал на новый домен **gmd-online.ru** — `gmd.link28rus.ru` отдаёт 301-redirect, но в комментарии модератору указываем уже новый адрес для минимизации недоразумений.

## Артефакт

- **AAB:** `releases/rustore/child/gmd-child-0.51.0+6088.aab`
- **Размер:** 57.8 МБ (Console покажет 5.06 МБ для base.apk — это норма, см. FAQ в README)
- **SHA-256:** `79d5142ef2b6c8304dce25b5192da9efea789fb42ca21b652dda52c4bcc9d76d`
- **Подпись:** тот же keystore что и предыдущие версии (cert DN `CN=GMD Child, OU=GMD, O=link28rus, L=Khabarovsk, ST=Khabarovsky Krai, C=RU`)
- **Версия в RuStore Console:** 0.51.0 (6088)

## Что изменилось vs v0.50.7(6087)

1. **Миграция на новый VPS и домен.** Прод переехал с `gmd.link28rus.ru` (192.168.1.23 dual-WAN) на `gmd-online.ru` (45.67.230.87 single-iface, Ubuntu 24.04). API endpoint mobile-приложений изменён в `apps/mobile-child/lib/core/config/env.dart` на `https://gmd-online.ru/api`. Старый домен отдаёт 301-redirect на новый, но API более не отвечает — пользователи на v0.50.7 и ниже должны обновиться через RuStore.
2. **Удалён self-hosted ACTION_VIEW installer (REQUEST_INSTALL_PACKAGES).** Раньше app сам качал APK и предлагал установить через системный installer — модерация RuStore это запрещает. Теперь auto-update идёт **только через RuStore In-App Update SDK** (`flutter_rustore_update: ^10.3.0`). Удалены: `lib/core/updates/installer_channel.dart`, `updates_service.dart`, `update_info.dart`, native `InstallerNative.kt`, `UpdateCheckWorker.kt`, `UpdateCheckScheduler.kt`, `xml/file_provider_paths.xml`.
3. **Добавлен RuStore Push SDK (`flutter_rustore_push: ^7.2.0`).** Параллельный канал доставки push'ей помимо FCM — нужен для устройств без Google Play Services (HMS Huawei, чистые AOSP, MIUI без GMS). Backend выбирает канал по `deviceCapabilities` устройства. На устройствах с GMS — FCM остаётся primary, RuStore Push — fallback.
4. **AndroidManifest очищен от QUERY_ALL_PACKAGES.** Уже было сделано в v0.50.6, но повторно verify: `aapt2 dump permissions` показывает 0 совпадений ни `REQUEST_INSTALL_PACKAGES`, ни `QUERY_ALL_PACKAGES`. Enumeration apps теперь через `<queries><intent><action MAIN/><category LAUNCHER/></intent></queries>` + `pm.queryIntentActivities(Intent(ACTION_MAIN).addCategory(CATEGORY_LAUNCHER))` в `AppControlNative.collectInstalledApps`. На физ.устройстве POCO X7 Pro / HyperOS Android 15 verified: 159 launchable apps собрано, 0 missing icons на backend.

## Wizard «Загрузить версию» — пошагово

URL: <https://console.rustore.ru/apps/2063713899/versions/add>

### Шаг 1 — «Файлы»

- AAB: `releases/rustore/child/gmd-child-0.51.0+6088.aab`
- **«Что нового»:**

  ```
  • Переход на основной канал распространения через RuStore.
  • Внутренние улучшения push-уведомлений.
  • Исправления ошибок.
  ```

- **«Комментарий для модератора»** (160/180):

  ```
  Логин: rustore-moderator@gmd.link28rus.ru, пароль: RsM-Test-2026-Md7K3p (gmd-online.ru/login, «По паролю»). Код привязки ребёнка: AJGD3K2D (многоразовый).
  ```

### Шаг 2 — «Безопасность»

- **«Типы данных» (9/38):** Точное местоположение • ID устройства или другие идентификаторы • Имя • ID пользователей • Взаимодействие с приложением • Установленные приложения • Аудиозаписи и голосовые сообщения • Диагностика • Отчёты об ошибках
- **«Обоснование разрешений»** (1410/1500):

  ```
  GMD «Ребёнок» — клиентская часть сервиса родительского контроля gmd-online.ru (аналог «Где мои дети», self-hosted, РФ-рынок).

  ACCESS_FINE_LOCATION / ACCESS_BACKGROUND_LOCATION — основная функция: отображение местоположения ребёнка в кабинете родителя, срабатывание геозон «дом/школа».

  RECORD_AUDIO + FOREGROUND_SERVICE_MICROPHONE — фича «Звук вокруг ребёнка»: родитель из кабинета может запросить кратковременный аудиомониторинг окружения. Сессия инициируется только по запросу родителя через push, активный foreground-service notification показывается.

  PACKAGE_USAGE_STATS — родительский контроль экранного времени: статистика использования приложений отображается в кабинете родителя.

  BIND_DEVICE_ADMIN — защита приложения от удаления ребёнком (опциональная, активируется родителем в кабинете).

  BIND_ACCESSIBILITY_SERVICE — родительский контроль: блокировка приложений по правилам и расписанию, заданным родителем.

  SYSTEM_ALERT_WINDOW — overlay «Это приложение заблокировано родителем» при попытке открыть запрещённое приложение.

  POST_NOTIFICATIONS — уведомления ребёнку (статус связи, SOS-подтверждение).

  RECEIVE_BOOT_COMPLETED + WAKE_LOCK + FOREGROUND_SERVICE_LOCATION + USE_EXACT_ALARM — корректная работа geo-сервиса в фоне после перезагрузки.

  ACTIVITY_RECOGNITION — экономия батареи (переключение GPS-профиля при STILL).

  Все функции описаны в политике конфиденциальности на gmd-online.ru.
  ```

### Шаг 3 — «Информация»

Если поля сохранились с прошлой подачи — оставить как есть. Если сбросились (RuStore wizard любит это делать), заполнить:

- **Название приложения:** `GMD для ребёнка`
- **Тип:** Приложение
- **Минимальная версия Android:** 8
- **Основная категория:** Родителям
- **Возрастное ограничение:** 6+
- **Краткое описание** (66/80):

  ```
  Подключите телефон ребёнка к родительскому контролю GMD по QR-коду
  ```

- **Полное описание** (2071/4000) — взять из `docs/rustore-store-listing.md` (раздел «App 2: GMD — для ребёнка → Полное описание»).
- **E-mail разработчика:** `link28rus@gmail.com`

### Шаг 4 — «Медиафайлы»

- **Иконка приложения** (512×512): `docs/rustore-assets/icon-child-512.png`
- **Скриншот для телефонов** (1080×1920, 9:16): `releases/rustore/child/screenshots/child-01-main.png`
- Скриншоты для планшетов — пропустить.

### Шаг 5 — «Параметры публикации»

- «Публикация версии»: **Автоматически — сразу после одобрения**
- Нажать **«Отправить на модерацию»**.

## Если модерация снова отклонит из-за «вход не осуществляется»

1. Проверить prod: `ssh gmd-online 'docker exec gmd-postgres psql -U gmd -d gmd -c "SELECT code, \"maxUses\", \"usesCount\", \"consumedAt\", \"expiresAt\" FROM invites WHERE code = '"'"'AJGD3K2D'"'"';"'`
   - Ожидаемо: `maxUses=100, usesCount<100, consumedAt=NULL, expiresAt > NOW()`.
2. Если invite по какой-то причине истёк / consumed — сбросить:

   ```bash
   ssh gmd-online 'docker exec gmd-postgres psql -U gmd -d gmd -c "UPDATE invites SET \"usesCount\" = 0, \"consumedAt\" = NULL, \"expiresAt\" = NOW() + INTERVAL '"'"'365 days'"'"' WHERE code = '"'"'AJGD3K2D'"'"';"'
   ssh gmd-online 'docker exec gmd-postgres psql -U gmd -d gmd -c "DELETE FROM child_devices WHERE \"childId\" = (SELECT id FROM children WHERE id IN (SELECT \"childId\" FROM invites WHERE code='"'"'AJGD3K2D'"'"'));"'
   ```

3. Также проверь от себя (не использует ли invite):

   ```bash
   curl -X POST https://gmd-online.ru/api/child/claim \
        -H "Content-Type: application/json" \
        -d '{"code":"AJGD3K2D","deviceName":"selftest","osVersion":"Android","appVersion":"0.51.0"}'
   ```

   Должен вернуть HTTP 200 с `deviceToken`. После теста выполни «сброс» из шага 2 чтобы счётчик не накопил.

## Verification после публикации

```bash
# 1. Health check API
curl -s https://gmd-online.ru/api/healthz                # {"status":"ok"}
curl -s https://gmd-online.ru/api/readyz                 # {"status":"ok","db":"up","redis":"up"}

# 2. RuStore Console / Console ID 2063713899 показывает 0.51.0 (6088) "Опубликовано"
```
