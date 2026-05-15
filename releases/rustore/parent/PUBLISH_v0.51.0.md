# Публикация parent v0.51.0(26) в RuStore — инструкция

> **TL;DR:** залить AAB по адресу ниже, скопипастить три блока текста в wizard, нажать «Отправить на модерацию». Это первая публикация parent app после миграции на новый VPS — комментарий модератору указывает уже новый домен `gmd-online.ru`. Прошлая опубликованная версия parent — 0.50.4(25) от 2026-05-13.

## Артефакт

- **AAB:** `releases/rustore/parent/gmd-parent-0.51.0+26.aab`
- **Размер:** 46.4 МБ
- **SHA-256:** `0a05a37e25994489af77b3896d8aaab70559f1b8a032cef38f569bb5a06cf998`
- **Подпись:** тот же keystore что и предыдущие версии (cert DN `CN=GMD Parent, OU=GMD, O=link28rus, L=Khabarovsk, ST=Khabarovsky Krai, C=RU`)
- **Версия в RuStore Console:** 0.51.0 (26)

## Что изменилось vs v0.50.4(25)

1. **Миграция на новый VPS и домен.** Прод переехал с `gmd.link28rus.ru` на `gmd-online.ru` (Ubuntu 24.04, 45.67.230.87). API endpoint и WebView origin изменены в `apps/mobile-parent/lib/core/config/env.dart` на `https://gmd-online.ru/api` и `https://gmd-online.ru`. Старый домен отдаёт 301-redirect, но API более не отвечает — пользователи на v0.50.4 должны обновиться через RuStore.
2. **Удалён self-hosted ACTION_VIEW installer (REQUEST_INSTALL_PACKAGES).** Раньше parent app сам качал APK и предлагал установить через системный installer. Теперь auto-update идёт **только через RuStore In-App Update SDK** (`flutter_rustore_update: ^10.3.0`). Удалены: `lib/core/updates/installer_channel.dart`, `updates_service.dart`, `update_info.dart`, native `InstallerNative.kt`, `xml/file_provider_paths.xml`.
3. **Добавлен RuStore Push SDK (`flutter_rustore_push: ^7.2.0`).** Параллельный канал доставки push'ей помимо FCM — нужен для устройств без Google Play Services. На устройствах с GMS — FCM остаётся primary, RuStore Push — fallback. Backend выбирает канал по `deviceCapabilities` устройства.
4. **Минорные UI-улучшения.** WCAG-контраст в страницах `/privacy` и `/terms` (тёмная палитра), фирменный favicon на вкладке сайта.

## Wizard «Загрузить версию» — пошагово

URL: <https://console.rustore.ru/apps/2063713895/versions/add>

### Шаг 1 — «Файлы»

- AAB: `releases/rustore/parent/gmd-parent-0.51.0+26.aab`
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

Permission-набор parent app минимальный — sensitive permissions не нужны (parent только показывает данные ребёнка, сам ничего не записывает на устройстве родителя).

- **«Типы данных» (7/38):** ID устройства или другие идентификаторы • Имя • ID пользователей • Электронная почта • Взаимодействие с приложением • Диагностика • Отчёты об ошибках
- **«Обоснование разрешений»** (если RuStore требует — sensitive permissions parent app не запрашивает, поэтому раздел может быть пустым / не показывается):

  ```
  GMD «Родитель» — клиентская часть сервиса родительского контроля gmd-online.ru (аналог «Где мои дети», self-hosted, РФ-рынок).

  Permission-набор parent app минимальный, sensitive permissions не запрашиваются. Используются только INTERNET / ACCESS_NETWORK_STATE / POST_NOTIFICATIONS / WAKE_LOCK / RECEIVE_BOOT_COMPLETED / FOREGROUND_SERVICE / com.google.android.c2dm.permission.RECEIVE.

  POST_NOTIFICATIONS — push'и о событиях (геозоны ребёнка, SOS, обновлениях).
  FOREGROUND_SERVICE + WAKE_LOCK — корректная работа Firebase Messaging.
  c2dm.permission.RECEIVE — обработка FCM push-сообщений.

  Все функции описаны в политике конфиденциальности на gmd-online.ru.
  ```

### Шаг 3 — «Информация»

Если поля сохранились с прошлой подачи (v0.50.4) — оставить. Если сбросились:

- **Название приложения:** `GMD: родительский контроль`
- **Тип:** Приложение
- **Минимальная версия Android:** 7
- **Основная категория:** Родителям
- **Возрастное ограничение:** 12+
- **Краткое описание** (≤80):

  ```
  Геолокация ребёнка, геозоны, SOS-кнопка, экранное время и аудиомониторинг
  ```

- **Полное описание** — взять из `docs/rustore-store-listing.md` (раздел «App 1: GMD — родительский контроль → Полное описание»).
- **E-mail разработчика:** `link28rus@gmail.com`

### Шаг 4 — «Медиафайлы»

- **Иконка приложения** (512×512): `docs/rustore-assets/icon-parent-512.png`
- **Скриншоты для телефонов** (3 шт., 1080×1920, 9:16):
  - `releases/rustore/parent/screenshots/parent-01-children.jpg`
  - `releases/rustore/parent/screenshots/parent-02-child-detail.jpg`
  - `releases/rustore/parent/screenshots/parent-03-login.jpg`
- Скриншоты для планшетов — пропустить.

### Шаг 5 — «Параметры публикации»

- «Публикация версии»: **Автоматически — сразу после одобрения**
- Нажать **«Отправить на модерацию»**.

## Verification после публикации

```bash
# 1. Health check API
curl -s https://gmd-online.ru/api/healthz                # {"status":"ok"}
curl -s https://gmd-online.ru/api/readyz                 # {"status":"ok","db":"up","redis":"up"}

# 2. POST rustore-token endpoint (новый в v0.51.0)
curl -sS -X POST -H "Content-Type: application/json" \
     -d '{"email":"rustore-moderator@gmd.link28rus.ru","password":"RsM-Test-2026-Md7K3p"}' \
     https://gmd-online.ru/api/auth/login-password   # 200 + accessToken

# 3. RuStore Console / Console ID 2063713895 показывает 0.51.0 (26) "Опубликовано"
```
