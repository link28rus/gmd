# Публикация parent v0.53.0(28) в RuStore — Public API

> **TL;DR:** опубликовано через Public API (`tools/rustore/rustore-publish.mjs`)
> 2026-07-05. Запись `pro.periscop.parent`, versionId **2064693129**, статус
> **на модерации**. Залит **APK** (не AAB — см. ниже).

## Артефакт

- **APK (залит в RuStore):** `apps/mobile-parent/build/app/outputs/flutter-apk/app-release.apk`
  (universal, 66.2 МБ, все ABI). SHA-256 `8203ff97d0b5a5e5fbe99fa8c70558edc73a9c6618fda51bee174d2b43378a7d`.
- **AAB (собран, НЕ залит):** `releases/rustore/parent/gmd-parent-0.53.0+28.aab`
  (55.5 МБ). SHA-256 `3d37cf84b20673352eb9a63a771fb5e2c9c400e5ff6da6fad7aa22177028a31f`.
- **versionCode:** 28 (> published 27). **versionName:** 0.53.0.
- **Подпись:** app-keystore `apps/mobile-parent/android` (CN=GMD Parent), тот же
  что предыдущие версии.
- **Label:** «Перископ Родителя» (`aapt2 dump badging`).

## Почему APK, а не AAB

Первая версия записи `pro.periscop.parent` (проход B, 0.52.0) заливалась как
**APK** через Console, RuStore App Signing (upload key + app signing key) для этой
записи **не настроен**. Попытка залить AAB через Public API даёт
`400 Upload failed: Ключи и сертификаты еще не загружены`. Поэтому версии этой
записи публикуются как **universal APK**, подписанный нашим app-keystore. Если в
будущем настроить App Signing в Console — можно будет переключиться на AAB.

## Что нового (whatsNew, отправлено)

```
• «История передвижений» — список поездок ребёнка за последние 30 дней и маршрут каждой поездки на карте.
• Тёмная тема и переключатель оформления: «Светлая», «Тёмная» или «Как в системе».
• Брендовая заставка «Перископ» при запуске приложения.
• Удаление ребёнка и отвязка устройства прямо в приложении, с подтверждением.
• Внутренние улучшения и исправления.
```

## Комментарий модератору (отправлено, ≤180)

Тест-вход родителя (email + пароль) + многоразовый invite `AJGD3K2D` на
`periscop.pro/login` («По паролю»). Точные креды — секрет в memory-compiler
(«RuStore moderator test account») и в `PUBLISH_v0.51.3.md`.

## Команда публикации

```bash
set -a; . ~/.rustore_publish.env; set +a   # RUSTORE_KEY_ID=2351029746 + RUSTORE_KEY_B64 (из memory-compiler)
node tools/rustore/rustore-publish.mjs publish --app parent \
  --apk apps/mobile-parent/build/app/outputs/flutter-apk/app-release.apk \
  --whatsnew "…" --moderinfo "…"
```

## Проверка / verification

```bash
# статус версии на модерации
node tools/rustore/rustore-publish.mjs status --app parent
#   0.53.0(28)  versionId=2064693129  статус=MODERATION → после approve ACTIVE

# Post-approve (Page Record): возрастное 6+, поисковые теги (перископ /
# родительский контроль / геолокация ребёнка / gmd / геозоны) — проверить
# в Console, self-service не редактируется (lesson #45).
```

## Verify

- **Этап 1 (AVD):** пройден по всем задачам версии — тема (light+dark,
  переключатель), splash (cold start), удаление ребёнка (E2E на проде).
- **Этап 2 (реальное устройство):** пропущен по решению пользователя.
- Backend изменений версии (endpoint отвязки устройства) задеплоен на прод
  до подачи.
