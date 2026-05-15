# Публикация child v0.50.7(6087) в RuStore — инструкция

> **TL;DR:** залить AAB по адресу ниже, скопипастить три блока текста в wizard, нажать «Отправить на модерацию». Multi-use invite уже настроен на проде, модератор сможет тестировать неограниченное число раз.

## Артефакт

- **AAB:** `releases/rustore/child/gmd-child-0.50.7+6087.aab`
- **Размер:** 60.57 МБ (Console покажет 5.06 МБ для base.apk — это норма, см. FAQ в README)
- **SHA-256:** `5eb4b2c9cb7253b71fa9544e26cea58e502b16114e6ec5e7bdb39376f180d814`
- **Подпись:** тот же keystore что и предыдущие версии (`apps/mobile-child/android/key.properties`)
- **Версия в RuStore Console:** 0.50.7 (6087)

## Что изменилось vs v0.50.6(6086)

Бинарник child app не менялся функционально — приложение работает идентично v0.50.6. Bump нужен только потому что RuStore не принимает повторную загрузку с прежним `versionCode`. Все исправления — **на стороне backend (prod уже задеплоен)**:

- В модель `Invite` добавлены `maxUses` + `usesCount`. `claim` endpoint теперь:
  - Принимает повторные claim'ы одного и того же кода пока `usesCount < maxUses`.
  - Для multi-use инвайтов (как наш модераторский) автоматически revoke'ает прежнее ChildDevice — каждый раз модератор привязывается «к чистому».
- Существующий invite `AJGD3K2D` обновлён до `maxUses=100`, `expiresAt=2027-05-14`, `usesCount=0`. Сейчас claim прошёл ноль раз (счётчик ресетнут после моих тестов).

## Wizard «Загрузить версию» — пошагово

URL: <https://console.rustore.ru/apps/2063713899/versions/add>

### Шаг 1 — «Файлы»

- AAB: `releases/rustore/child/gmd-child-0.50.7+6087.aab`
- **«Что нового»:**

  ```
  Технические улучшения и исправления ошибок.
  ```

- **«Комментарий для модератора»** (168 символов, лимит 180):

  ```
  Логин: rustore-moderator@gmd.link28rus.ru, пароль: RsM-Test-2026-Md7K3p (gmd.link28rus.ru/login, «По паролю»). Код привязки ребёнка: AJGD3K2D (многоразовый).
  ```

### Шаг 2 — «Безопасность»

- **«Типы данных» (9/38):** Точное местоположение • ID устройства или другие идентификаторы • Имя • ID пользователей • Взаимодействие с приложением • Установленные приложения • Аудиозаписи и голосовые сообщения • Диагностика • Отчёты об ошибках
- **«Обоснование разрешений»** (1411/1500):

  ```
  GMD «Ребёнок» — клиентская часть сервиса родительского контроля gmd.link28rus.ru (аналог «Где мои дети», self-hosted, РФ-рынок).

  ACCESS_FINE_LOCATION / ACCESS_BACKGROUND_LOCATION — основная функция: отображение местоположения ребёнка в кабинете родителя, срабатывание геозон «дом/школа».

  RECORD_AUDIO + FOREGROUND_SERVICE_MICROPHONE — фича «Звук вокруг ребёнка»: родитель из кабинета может запросить кратковременный аудиомониторинг окружения. Сессия инициируется только по запросу родителя через push, активный foreground-service notification показывается.

  PACKAGE_USAGE_STATS — родительский контроль экранного времени: статистика использования приложений отображается в кабинете родителя.

  BIND_DEVICE_ADMIN — защита приложения от удаления ребёнком (опциональная, активируется родителем в кабинете).

  BIND_ACCESSIBILITY_SERVICE — родительский контроль: блокировка приложений по правилам и расписанию, заданным родителем.

  SYSTEM_ALERT_WINDOW — overlay «Это приложение заблокировано родителем» при попытке открыть запрещённое приложение.

  POST_NOTIFICATIONS — уведомления ребёнку (статус связи, SOS-подтверждение).

  RECEIVE_BOOT_COMPLETED + WAKE_LOCK + FOREGROUND_SERVICE_LOCATION + USE_EXACT_ALARM — корректная работа geo-сервиса в фоне после перезагрузки.

  ACTIVITY_RECOGNITION — экономия батареи (переключение GPS-профиля при STILL).

  Все функции описаны в политике конфиденциальности на gmd.link28rus.ru.
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

1. Проверить prod: `ssh gmd-prod 'docker exec gmd-postgres psql -U gmd -d gmd -c "SELECT code, \"maxUses\", \"usesCount\", \"consumedAt\", \"expiresAt\" FROM invites WHERE code = \$\$AJGD3K2D\$\$;"'`
   - Ожидаемо: `maxUses=100, usesCount<100, consumedAt=NULL, expiresAt > NOW()`.
2. Если invite по какой-то причине истёк / consumed — сбросить:

   ```bash
   ssh gmd-prod 'docker exec gmd-postgres psql -U gmd -d gmd -c "UPDATE invites SET \"usesCount\" = 0, \"consumedAt\" = NULL, \"expiresAt\" = NOW() + INTERVAL '"'"'365 days'"'"' WHERE code = '"'"'AJGD3K2D'"'"';"'
   ssh gmd-prod 'docker exec gmd-postgres psql -U gmd -d gmd -c "DELETE FROM child_devices WHERE \"childId\" = '"'"'cmp2esdlt00055ua1gb9zxk95'"'"';"'
   ```

3. Также проверь от себя (не использует ли invite):

   ```bash
   curl -X POST https://gmd.link28rus.ru/api/child/claim \
        -H "Content-Type: application/json" \
        -d '{"code":"AJGD3K2D","deviceName":"selftest","osVersion":"Android","appVersion":"0.50.7"}'
   ```

   Должен вернуть HTTP 200 с `deviceToken`. После теста выполни «сброс» из шага 2 чтобы счётчик не накопил.
