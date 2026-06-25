# RuStore-релиз: AAB + скриншоты Перископа

Single source of truth для всего, что отправляется в RuStore Console:
бинарники AAB + скриншоты для wizard'а каждой подачи Перископа (родитель + ребёнок).

**Сами `.aab` в git НЕ коммитим** (см. `.gitignore`) — они тяжёлые (~50MB)
и точно воспроизводимы через `flutter build appbundle --release` из того же
коммита. **Скриншоты — коммитим** (~50-200KB каждый, нужны при каждом
ресабмите). Локальные AAB Перископа-родителя и Перископа-ребёнка лежат в `parent/` и `child/` для быстрого re-upload.

## Layout

```
releases/rustore/
├── README.md            ← этот файл (реестр версий + SHA-256)
├── .gitignore           ← *.aab, *.apk
├── parent/
│   ├── gmd-parent-<X.Y.Z>+<N>.aab        ← AAB (не в git)
│   └── screenshots/
│       ├── parent-01-children.jpg        ← processed 1080×1920 (9:16), в git
│       ├── parent-02-child-detail.jpg
│       ├── parent-03-login.jpg
│       └── raw/                          ← оригинальные device screencaps (IMG_*.png), в git
└── child/
    ├── gmd-child-<X.Y.Z>+<N>.aab         ← AAB (не в git)
    └── screenshots/
        ├── child-01-permissions-guard.png ← processed 1080×1920 (9:16), в git
        └── raw/                          ← оригинальные device screencaps
```

Имена AAB для Перископа строго `gmd-{parent,child}-<X.Y.Z>+<N>.aab` — `<X.Y.Z>` из
корневого `package.json`, `+<N>` из `apps/mobile-{parent,child}/pubspec.yaml`
(`version: X.Y.Z+N`). Это `pubspec build`, **не** effective versionCode с
ABI offset (lesson #14). (Примечание: префикс `gmd-` в имени артефакта — историческая конвенция до ребрендинга, сохранена для стабильности контрактов имён файлов.)

Имена скриншотов: `{app}-NN-descriptor.{jpg,png}` — порядок NN определяет
showcase в Console (первая = preview в каталоге RuStore).

## Реестр опубликованных версий

| Дата       | App    | Версия        | versionCode | RuStore Console ID | Статус                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | SHA-256 (AAB)                                                    |
| ---------- | ------ | ------------- | ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-05-20 | parent | 0.51.3 (27)   | 27          | 2063713895         | 📦 Готово к подаче — rebrand «GMD: родитель» → «Перископ Родитель» (android:label, MaterialApp.title, user-facing строки на экранах входа/добавления ребёнка/защиты). AVD smoke x86_64 пройден: `application-label:'Перископ Родитель'`, экран входа «Вход в Перископ», versionName 0.51.3 versionCode 27, синий pin в task switcher. Этап 2 (реальное устройство) пропущен по решению — изменения только текстовые, разрешения/логика не тронуты. Инструкция: `PUBLISH_v0.51.3.md` (age 6+, теги: перископ / родительский контроль / геолокация ребёнка / gmd / геозоны). Submit через Console wizard ожидает действия.                                                                                                                                       | 857323e77b81639acfb28c15786e2ab176f7d40f689a4c15ebbc561d9819d7fa |
| 2026-05-17 | child  | 0.51.2 (6090) | 6090        | 2063713899         | ✅ Опубликовано (17.05.2026 15:25 MSK, через ~1 час после submit'а). Rebrand «GMD Ребёнок» → «Перископ Ребёнка» принят модератором, имя в Console обновилось. Изменения: android:label «Перископ Ребёнка», AppBar header «Перископ», brand-иллюстрация на onboarding (assets/images/onboarding_hero.png), пустое поле ввода кода (убран hint), имя семьи на home («Ты подключён к семье «<имя>»» через расширенный /child/me, поле family). Smoke-test пройден на AVD x86_64 + POCO X7 Pro / HyperOS 15. Backend задеплоен на прод. Submit через Playwright wizard 2026-05-17 ~14:25 MSK. Crash из v0.51.1 reject «аварийно закрывается после авторизации» НЕ повторился (либо специфичен для одного тестера/окружения, либо случайно починен rebrand-патчем). | c4475fca4562d1d0f01e0f84b01a7163c03bc4cd9d50da8654ae5b73ca96f211 |
| 2026-05-16 | child  | 0.51.1 (6089) | 6089        | 2063713899         | ❌ Модерация не пройдена — «Приложение не прошло модерацию, поскольку оно аварийно закрывается после авторизации». Crash не воспроизвёлся на AVD + Тимоха при ретесте — возможно специфичен для окружения модератора. v0.51.2 пересобрана с rebrand'ом + другим Dart-кодом, регрессий нет.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | cc65223cfb4f4ae4056ad49e94b2bde934bedf0817d6a66214756be747274f5f |
| 2026-05-15 | child  | 0.51.0 (6088) | 6088        | 2063713899         | ⏳ Ожидает модерацию (Version ID 2064613356; миграция gmd-online.ru + RuStore Push SDK + In-App Update SDK, удалён self-hosted installer; email модератора обновлён на rustore-moderator@gmd-online.ru)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 79d5142ef2b6c8304dce25b5192da9efea789fb42ca21b652dda52c4bcc9d76d |
| 2026-05-15 | parent | 0.51.0 (26)   | 26          | 2063713895         | ⏳ Ожидает модерацию (миграция gmd-online.ru + RuStore Push SDK + In-App Update SDK, удалён self-hosted installer; email модератора обновлён на rustore-moderator@gmd-online.ru)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0a05a37e25994489af77b3896d8aaab70559f1b8a032cef38f569bb5a06cf998 |
| 2026-05-13 | parent | 0.50.4 (25)   | 25          | 2063713895         | ✅ Опубликовано                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | fcf797b681b560ab09e128127eeee2c0eaeef51fd26fa054b542f3c962e47f40 |
| 2026-05-15 | child  | 0.50.7 (6087) | 6087        | 2063713899         | ✅ Опубликовано (фикс «вход не осуществляется»: invite `AJGD3K2D` multi-use 100/365d на проде, backend v0.50.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 5eb4b2c9cb7253b71fa9544e26cea58e502b16114e6ec5e7bdb39376f180d814 |
| 2026-05-14 | child  | 0.50.6 (6086) | 6086        | 2063713899         | ❌ Модерация не пройдена — «приложение не прошло из-за невозможности тестирования, после ввода кода вход не осуществляется» (invite был single-use и уже consumed при первой итерации модерации)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 9f335928b50b9382df3176cdf13d9b74c3f1ce942e6ebe55875915bc03d4b379 |
| 2026-05-14 | child  | 0.50.5 (6085) | 6085        | 2063713899         | ❌ Модерация не пройдена — «не соответствует нормам информационной безопасности. Необходимо убрать расширение QUERY_ALL_PACKAGES»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 4e7568edd1715e6cf1584a641e265229bb82a57db248e026ca8b21ec748c3c98 |
| 2026-05-13 | child  | 0.50.4 (6084) | 6084        | 2063713899         | ❌ Модерация не пройдена (ошибочно, шаблонный отказ за REQUEST_INSTALL_PACKAGES — permission в AAB отсутствовал, verified `aapt2 dump permissions` + `dumpsys`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 4b59922b9a7bbeb92185a08abd248aa810e00e5ec9c4322442625c36ceb52f2c |

Прошлые отклонённые версии (0.50.1-0.50.3) — см. историю в RuStore Console и в
`.taskmaster/tasks/tasks.json` (задача #64). AAB этих версий не сохраняются.

## Скриншоты для RuStore wizard

**ПРАВИЛО:** при подаче в RuStore Console (шаг 4 «Скриншоты для телефонов»)
скрины каждого app берутся **только** из его собственной папки
`releases/rustore/{parent,child}/screenshots/`. Не из `docs/rustore-assets/`,
не из временных папок. Это single source of truth.

### Требования RuStore

- Соотношение **строго 9:16 (portrait)** или 16:9 (landscape). Рекомендация —
  **1080×1920 portrait**.
- 1080×2400 (9:20 от современных Android-устройств) **не подходит** — отказ
  модератора (lesson #26).
- Размер до 5 MB JPG/PNG, минимум 1 скрин, максимум 10.
- Для apps с stalkerware-like permission set (child) — **реальные device-
  screencaps лучше promo-карточек**: модератор может попросить заменить
  promo на реальный UI (lesson #26).

### Workflow snap → process → commit

1. **Поднять wireless ADB / USB** к устройству (lesson #25 — pair-port vs
   main adb-port).
2. **Открыть нужный экран в parent/child app**, дождаться загрузки.
3. **БЛОКИРУЮЩИЙ: закрыть все модалы / уведомления / попапы поверх UI.**
   Перед screencap'ом убедиться что виден **чистый UI приложения**:
   - Закрыть post-update permission guard / consent banner / любой alert
     (нажать «Позже» / «Понятно» / dismiss кнопку).
   - Свайпнуть вниз notification shade если есть нотификации поверх app.
   - Если на скрине будут модалы — модератор и пользователь в каталоге
     RuStore НЕ увидят сам app, только сообщение поверх. Это уменьшает
     эффективность showcase и может вызвать вопросы модератора
     («не работает?», «зависло?»).
4. **Снимок:** `adb -s <serial> exec-out screencap -p > tmp.png`. Современные
   Android phone обычно дают 1080×2400 (9:20) — нужна обработка.
5. **Обработка:** `python tools/rustore/process_screenshots.py tmp.png releases/rustore/{parent,child}/screenshots/{app}-NN-descriptor.{jpg,png}`.
   - 9:20 → top-bias crop по высоте до 9:16, сохраняет status bar + header.
   - landscape (16:9) → center-crop по ширине.
   - LANCZOS resize до 1080×1920.
6. **Visual review processed скрина перед commit'ом.** Открыть
   `releases/rustore/{parent,child}/screenshots/<file>` и убедиться:
   - **Виден чистый функциональный UI app** (главный экран / список / форма /
     карта — то что реально показывает работу приложения).
   - **НЕТ модалов / notification shade / системных popup'ов поверх UI.**
   - Имя файла и порядковый номер NN — осмысленные (первая = preview в
     каталоге, должна быть самой «продающей»).
7. **Commit** скрины в репо вместе с bumped версией и обновлённым реестром
   в этом README.

### История

- **parent v0.50.4:** 3 скрина (`parent-01-children.jpg`, `parent-02-child-detail.jpg`,
  `parent-03-login.jpg`) сняты пользователем на POCO X7 Pro / HyperOS, переданы
  через Telegram (576×1280 сжатое), обработаны Pillow top-bias crop +
  LANCZOS upscale до 1080×1920.
- **child v0.50.4:** 1 скрин (`child-01-diagnostics.png`) — DiagLog экран
  (long-press на версии в child app), 720×1640 → 1080×1920.

## FAQ / частые вопросы

### «Размер 5.06 МБ» на странице версии в Console — не баг

RuStore Console на странице конкретной версии (`/apps/<id>/versions/<version_id>`)
показывает поле «Размер» рядом с возрастным рейтингом — это **размер
`base.apk` после AAB split**, не суммарный bundle. Для Flutter app:

| Часть AAB                | Размер   | Что внутри                                              |
| ------------------------ | -------- | ------------------------------------------------------- |
| `base.apk`               | ≈ 5-6 МБ | манифест, resources, assets/flutter_assets, dex         |
| `config.arm64_v8a.apk`   | ≈ 12 МБ  | native libs для arm64 (libapp.so + libflutter.so + ...) |
| `config.armeabi_v7a.apk` | ≈ 12 МБ  | native libs для arm32                                   |
| `config.x86_64.apk`      | ≈ 13 МБ  | native libs для эмуляторов                              |

При установке через RuStore client на arm64-устройство пользователь скачает
`base.apk` + `config.arm64_v8a.apk` ≈ 17-20 МБ. Полный AAB размер (57+ МБ)
видно только на шаге «Файлы» wizard'а при upload: `gmd-child-X.Y.Z+N.aab •
57.76 МБ — Загружено ✓`.

**Не путать с corrupted upload.** Если на шаге Upload показан полный
размер 57+ МБ — AAB корректный, 5 МБ на странице версии — штатное
представление RuStore.

**Verify integrity AAB:** `unzip -l releases/rustore/<app>/*.aab | grep '\.so$'` —
должны быть `libapp.so` + `libflutter.so` для всех 3 ABI. Plus
`aapt2 dump permissions` на собранном APK.

История инцидента: child v0.50.4(6084) был отклонён модератором с
шаблонной формулировкой про `REQUEST_INSTALL_PACKAGES`. Размер «5.06 МБ»
в Console навёл на подозрение что upload corrupted. Verify через aapt2 +
dumpsys на устройстве показал что AAB полностью корректный, native libs
на месте, permission удалён. Отказ был чистый шаблонный. Child v0.50.5(6085)
с идентичным контентом тоже показывает 5.06 МБ — подтверждено что это
штатное поведение Console, не баг.

## Workflow при подаче новой версии

1. **Bump** в корневом `package.json` + `pnpm version:sync` + bump
   `version: X.Y.Z+N` в обоих pubspec'ах (RuStore требует strictly increasing
   versionCode).
2. **Build**: `flutter build appbundle --release` в `apps/mobile-{parent,child}`.
3. **Verify подписи** — `jarsigner -verify -verbose -certs build/.../app-release.aab`,
   тот же keystore что прошлый релиз.
4. **Real-device smoke test (обязательно, БЛОКИРУЮЩИЙ ШАГ).** Параллельно с AAB
   собираем APK обоих apps (`flutter build apk --release` или
   `--split-per-abi`), ставим на физическое устройство через `adb install -r`
   (lesson #12 — проверка `dumpsys package | grep signatures` перед install,
   без `flutter install` чтобы не сделать uninstall + data loss). На устройстве
   реально пройти golden path обоих apps:
   - **parent:** логин → главный экран «Мои дети» → открыть карточку ребёнка →
     карта подгружается → запустить «Звук вокруг» / «Отправить сигнал» (хотя бы
     один) → push-уведомление о геозоне приходит (если есть тестовый ребёнок
     онлайн).
   - **child:** установка → claim по QR от parent (если устройство ещё не
     привязано) или открытие уже привязанного → главный экран SOS виден →
     DiagLog (long-press на версии) показывает свежие saveNativeCreds + push
     handshake без ошибок.
   - **Версия в UI** обоих apps совпадает с тем, что в pubspec
     (`X.Y.Z (N)` / `X.Y.Z+N`). Если на главном экране parent / в About child
     отображается старая версия — APK не тот, не пускаем дальше.
   - Если что-то сломано — НЕ загружаем AAB в RuStore. Фиксим в коде, bump
     `+N+1`, пересобираем, повторяем smoke. Цена отозвать черновик в RuStore
     ниже чем цена отказа модерации (1-3 дня минимум на каждый круг).
5. **Copy + rename** AAB в `releases/rustore/{parent,child}/gmd-{parent,child}-X.Y.Z+N.aab`.
6. **SHA-256** — `sha256sum releases/rustore/{parent,child}/*.aab` — обновить
   таблицу в этом README.
7. **Скриншоты** — проверить актуальность файлов в `releases/rustore/{parent,child}/screenshots/`.
   Если UI изменился — переснять и обработать (см. раздел «Скриншоты для
   RuStore wizard» выше). Если не изменился — переиспользовать.
8. **Upload** в RuStore Console через wizard (Файлы → Безопасность → Информация
   → Медиа → Параметры → «Отправить на модерацию»):
   - Шаг «Файлы»: AAB из `releases/rustore/{parent,child}/`.
   - **Шаг «Информация» — БЛОКИРУЮЩИЕ поля, обычно сбрасываются между
     submission'ами (lesson #38 sticky-fields + 2026-05-17 incident):**
     - **«Возрастное ограничение»** проверить и явно выставить (для child — 6+,
       для parent — 6+). Default 0+ при сбросе. После approve проверяется на
       Page Record `/apps/<id>` блок «Категории → Возрастная».
     - **«Поисковые теги» (0/5 — обязательно заполнить до 5):**
       - **child:** `перископ`, `родительский контроль`, `геолокация ребёнка`,
         `gmd`, `sos`. **Why `gmd`:** legacy-пользователи продолжают искать
         по старому имени, без этого тега «gmd» в каталоге не находит апп.
         **Why `перископ`:** display name в search-index появляется не сразу
         после rebrand'а, тег закрывает gap. Lesson #46 (incident 2026-05-17 —
         поиск «перископ» возвращал пусто, «gmd» возвращал нашу карточку).
       - **parent:** `gmd`, `родительский контроль`, `геолокация ребёнка`,
         `геозоны`, `sos` (parent аналогично — заполнить при следующем submit).
     - **«Название приложения»** — должно соответствовать app-rebrand'у
       (для child — «Перископ Ребёнка», для parent — «GMD: родитель»).
   - Шаг «Медиа»: иконка `docs/rustore-assets/icon-{parent,child}-512.png`
     - скрины **строго** из `releases/rustore/{parent,child}/screenshots/`.
   - Тестовые credentials модератору + актуальный invite — обязательно в
     комментарий (lesson #26 + fix-script для long-lived invite).
9. **Post-submit verify** (после approve, ~1 час — 3 дня): открыть
   `https://console.rustore.ru/apps/<id>` (Страница приложения), проверить
   блоки «Категории» (Возрастная = заявленное, Поисковые теги = 5 keywords,
   не «—»). Если поля пустые — это означает что в wizard'е сбросилось и
   submit прошёл с дефолтами. Submit придётся повторить со следующим
   bump'ом версии — Page Record self-service не редактируется отдельно от
   submit'а (verified 2026-05-17).
10. **Commit** обновлённый README.md + bumped версии + CHANGELOG + новые
    скрины (если переснимали).

## Lessons (см. CLAUDE.md)

- **#4 (rule):** AAB и APK одного app — один keystore. Иначе `adb install -r`
  упрётся в signature mismatch на устройствах с self-hosted установкой.
- **#14:** число после `+` в имени = pubspec build, **не** effective versionCode.
- **#23-26:** модерация RuStore квирки — REQUEST_INSTALL_PACKAGES не пройдёт,
  9:16 для скринов, credentials в комментарии модератору, long-lived invite
  через docker exec.
