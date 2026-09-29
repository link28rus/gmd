# Фото ребёнка и стандартные аватары (v0.61.0)

Родитель задаёт ребёнку аватар: своё фото или один из 12 стандартных зверят.
Без выбора — как раньше, цветной кружок с первой буквой имени.

## Решения

- **Хранение фото — Postgres (`bytea`)**, отдельная таблица `child_avatar_photos` 1:1 с `children`.
  MinIO с прода убран (#85); прецедент — `app_icons`. Отдельная таблица, чтобы байты не
  тянулись в каждую выборку `Child`.
- **Сжатие — на клиенте** (web canvas, Flutter `image_picker` maxWidth/imageQuality). Сервер
  не перекодирует (sharp на CPU без AVX — риск), только проверяет сигнатуру и размер.
- **Фото — ПДн (152-ФЗ): отдаётся только под JWT родителя этой семьи.** Web грузит через
  `apiFetch` в blob → object URL; mobile — через Dio (интерсептор с refresh) → `Image.memory`.
- **Пресеты — статические SVG**, один генератор `tools/avatars/generate_presets.py` пишет в
  `apps/web/public/avatars/` и `apps/mobile-parent/assets/avatars/`.
- Удаление ребёнка (soft-delete → hard-delete) — фото уходит каскадом (`onDelete: Cascade`).
  При soft-delete фото не отдаётся (ребёнок не находится в семье).

## Модель данных

`Child.avatarKey String?` (поле уже есть, раньше не использовалось):

| значение          | смысл                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| `null`            | буква имени (по умолчанию)                                                  |
| `preset:<id>`     | стандартный аватар, `<id>` из списка ниже                                   |
| `photo:<version>` | своё фото; `<version>` — первые 12 hex sha256 байтов (для кэша на клиентах) |

Пресеты: `fox bear panda cat bunny owl penguin frog lion koala puppy tiger`.

```prisma
model ChildAvatarPhoto {
  childId   String   @id
  child     Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  mime      String   // image/jpeg | image/png | image/webp
  sha256    String
  data      Bytes
  updatedAt DateTime @updatedAt
  @@map("child_avatar_photos")
}
```

## API (backend, `JwtAuthGuard`, проверка что ребёнок в семье родителя)

- `GET /family/children` — в каждом элементе добавлено `avatarKey: string | null`.
- `PUT /family/children/:childId/avatar` — JSON, ровно одно из:
  - `{ "preset": "fox" }` → `avatarKey = preset:fox`, фото удаляется;
  - `{ "photo": { "mime": "image/jpeg", "base64": "..." } }` → upsert фото,
    `avatarKey = photo:<version>`. Лимит 300 КБ после декодирования, сигнатура файла должна
    совпадать с `mime` (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`).
    Ответ `200 { "avatarKey": "..." }`. Ошибки: `400 invalid_avatar`, `413 avatar_too_large`.
- `DELETE /family/children/:childId/avatar` → `avatarKey = null`, фото удаляется. `204`.
- `GET /family/children/:childId/avatar` → байты фото, `Content-Type` из `mime`,
  `Cache-Control: private, max-age=86400`, `ETag: "<sha256>"`. `404`, если фото нет.

Web: `/api/children/:id/avatar` (GET/PUT/DELETE) — Next route handler, проксирует в backend
(GET — бинарно, без JSON-парсинга).

## Клиенты

- **Web:** общий компонент `ChildAvatar` (буква / пресет / фото) во всех местах, где сейчас
  рисуется буква ребёнка: сайдбар, карточка на карте, «не привязан», маркер на карте, список
  детей. Диалог «Фото профиля»: сетка пресетов, «Загрузить фото» (квадратная обрезка по центру,
  512×512 JPEG q≈0.85), «Убрать». Открывается кликом по аватару в карточке и пунктом меню
  ребёнка.
- **Mobile-parent:** виджет `ChildAvatar` (flutter_svg для пресетов, Dio → `Image.memory` для
  фото, кэш по `childId+version`) в карточке на главной, карточке статуса и маркере на карте.
  Пункт «Фото профиля» в меню ребёнка → bottom sheet: пресеты, «Галерея», «Камера», «Убрать».
  Пакеты `image_picker`, `flutter_svg`.
