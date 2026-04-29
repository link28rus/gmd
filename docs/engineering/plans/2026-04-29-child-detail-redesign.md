# Plan: редизайн экрана ребёнка на mobile-parent

**Date:** 2026-04-29
**Target version:** v0.50.0 (или v0.47.0 если поэтапно)
**Status:** approved, ready to implement
**Related decisions:**

- mobile-parent = primary canal (стратегический pivot 2026-04-29)
- WebView embed для тяжёлых web-первичных экранов (ADR §6 в PROJECT.md)
- Hybrid: native для простого + embed для Родительского контроля (см. §Решение ниже)

---

## Контекст

Сейчас на `ChildDetailScreen` (`apps/mobile-parent/lib/features/child_detail/child_detail_screen.dart`) — карта flutter_map + bottom-panel из 4 горизонтальных плиток: «Сигнал ✓ | Звук ✓ | Геозоны stub | Блокировка stub». Реально работают только 2.

Web-кабинет (`/cabinet/children/[id]`) предоставляет полный набор:

1. ChildStatusCard (имя, был тут N мин назад, 4 метрики: батарея/точность/связь/источник)
2. История передвижений (DateSelector + Polyline + список точек)
3. Родительский контроль (usage stats + bar chart + 3-state app rules + block sessions)
4. Защита от удаления (toggle)
5. Отправить сигнал ✓
6. Звук вокруг ✓
7. Отвязать устройство (POST `family/children/:id/reset-device`)
8. Удалить ребёнка (typed-confirm + DELETE)

Цель: портировать **весь** функционал в mobile-parent. Web → второстепенный канал.

## Решение: hybrid native + embed

**Native** для всего, КРОМЕ Родительского контроля — там слишком большой UI (usage chart + bar chart + категории + ActiveBlockCard + BlockDialog + 3-state app-rules с поиском/фильтрами/иконками). Native-порт = 3-5 дней. Embed `/embed/parental-control/[childId]` через webview_flutter — 0.5 дня (паттерн уже отлажен на Звуке).

Когда дойдут руки до полноценного native parental control (через 1-3 месяца, по реальной телеметрии использования) — заменим WebView на native экран. Маршрут `/home/child/:id/parental-control` остаётся, меняется только реализация.

**Принципы где native, где embed:**

- **Native** — простой виджет ИЛИ часто используется ИЛИ интегрирован с системой (карта, push-обработка, FAB, sheet)
- **Embed** — экран большой, сложный, web-первичный, редко используется

## Раскладка экрана

```
┌─────────────────────────────────┐
│ AppBar: Имя + ⋮ (Редактировать) │
├─────────────────────────────────┤
│                                 │
│          КАРТА (OSM)            │
│                                 │
│                                 │
├─────────────────────────────────┤  ← collapsible bottom-sheet
│ ▬                               │  ← drag handle
│ ┌─────────────────────────┐     │
│ │ Степан                  │ ⌃  │  ← collapsed header (всегда виден)
│ │ Был тут 58 мин назад    │     │
│ │ 🔋100% 🎯±10м 📶5G 📡GPS│     │
│ └─────────────────────────┘     │
│                                 │  ← expanded part (свайп ↑ для показа)
│ ⏱  История передвижений    →    │
│ 🛡  Родительский контроль  →    │  (embed)
│ 🔒 Защита от удаления    [▣]   │  ← toggle
│ 🔔 Отправить сигнал        →    │
│ 🎧 Звук вокруг             →    │
│ 🔄 Отвязать устройство     →    │
│ 🗑 Удалить ребёнка         →    │  ← red, destructive
└─────────────────────────────────┘
```

`DraggableScrollableSheet` с `initialChildSize ≈ 0.18` (свернут — видна только статус-карточка + drag handle + chevron «развернуть»), `maxChildSize ≈ 0.7` (раскрыт — все 7 пунктов). Карта при collapsed = почти весь экран, при expanded = четверть сверху.

## Этапы (одна ветка `feat/child-detail-redesign`, релиз v0.50.0 в конце)

### Этап 1: Shell + ChildStatusCard + collapsible sheet

**Коммит:** `feat(child-detail): collapsible sheet + status card`
**Дней:** 1

- [ ] Расширить `ChildLocation` модель полями: `isCharging`, `provider`, `networkType`, `wifiSsid`, `mobileOperator`. Backend уже отдаёт их в `latest`. Файл: `apps/mobile-parent/lib/features/children/child_models.dart`.
- [ ] Создать `_ChildStatusCard` widget (порт из `apps/web/components/locations/child-status-card.tsx`):
  - Avatar + имя + «Был тут N мин назад»
  - Grid 4×1 метрик: 🔋батарея / 🎯точность / 📶связь / 📡источник
  - Footer: «Точность координат высокая/средняя/низкая (N метров)»
- [ ] Заменить horizontal `_BottomPanel` на `DraggableScrollableSheet`:
  - Wrapper Stack, sheet поверх карты
  - `initialChildSize: 0.18`, `minChildSize: 0.18`, `maxChildSize: 0.7`
  - Drag handle сверху + ChildStatusCard в always-visible части
  - Список 8 `ListTile`-style тайлов в раскрываемой части (4 stub'а snackbar для этапа 1)
- [ ] Удалить старый `_LocationLine` (его инфа теперь в ChildStatusCard) и старые 4 `_ActionTile` плитки.
- [ ] Smoke-test на 192.168.77.154 через ADB.

### Этап 2: Защита от удаления (toggle)

**Коммит:** `feat(child-detail): protection toggle`
**Дней:** 0.3

- [ ] Добавить в `ChildrenRepository`:
  - `Future<({bool enabled, DateTime? enabledAt})> getProtection(String childId)` — `GET family/children/:id/protection`
  - `Future<void> setProtection(String childId, bool enabled)` — `PATCH family/children/:id/protection {enabled}`
- [ ] Provider `childProtectionProvider(childId)` — AsyncNotifier с optimistic update.
- [ ] ListTile «Защита от удаления» с trailing `Switch`:
  - При toggle ON → показать AlertDialog с предупреждением (как в web `child-card.tsx`):
    «Включить защиту от удаления? Ребёнок не сможет удалить или отключить приложение GMD на своём устройстве. Применится в течение нескольких секунд.»
  - При toggle OFF → AlertDialog «Отключить защиту? Ребёнок сможет удалить приложение.»
  - На успех — toast «Защита включена/отключена»
  - На 4xx/5xx — toast с error + revert тумблера

### Этап 3: Отвязать устройство

**Коммит:** `feat(child-detail): reset device action`
**Дней:** 0.3

- [ ] Добавить в `ChildrenRepository`:
  - `Future<void> resetDevice(String childId)` — `POST family/children/:id/reset-device` (HTTP 204)
- [ ] ListTile «Отвязать устройство»:
  - При тапе → AlertDialog (порт из web `reset-device-dialog.tsx`):
    «Сбросить устройство? Телефон <child.name> перестанет передавать данные. Нужно будет привязать устройство заново через новый QR.»
  - На confirm → invalidate `childrenListProvider` → home reload → toast «Устройство отозвано»
  - 429 (`Throttle 10/600s`) → toast «Слишком частые операции. Попробуйте позже.»

### Этап 4: Удалить ребёнка

**Коммит:** `feat(child-detail): delete child action`
**Дней:** 0.3

- [ ] Добавить в `ChildrenRepository`:
  - `Future<void> deleteChild(String childId)` — `DELETE family/children/:id` (HTTP 204, soft-delete)
- [ ] ListTile «Удалить ребёнка» — красная (`color: Colors.red.shade700`)
- [ ] При тапе → AlertDialog с typed-confirmation (порт из web `delete-child-dialog.tsx`):
  - Заголовок: «Удалить ребёнка?»
  - Описание: «Устройство будет отвязано, все инвайты станут недействительны. Действие нельзя отменить.»
  - TextField: «Введите имя <child.name> для подтверждения»
  - Кнопка «Удалить» disabled пока typed != child.name
- [ ] На confirm → invalidate `childrenListProvider` → `context.go('/home')` → toast «Ребёнок удалён»

### Этап 5: История передвижений

**Коммит:** `feat(child-detail): location history screen`
**Дней:** 1-2

- [ ] Новый маршрут: `/home/child/:id/history` → `LocationHistoryScreen`
- [ ] UI structure:
  - AppBar с DateSelector (← дата →, today shortcut)
  - Top half: карта с polyline за выбранный день + остановки (markers)
  - Bottom half: список точек, сгруппированных по часам
- [ ] Provider `childHistoryProvider({childId, date})` использует `ChildrenRepository.locations()` (уже существует в repo, принимает `from`/`to`).
- [ ] Полилиния: `PolylineLayer` зелёного цвета как на active-track сейчас.
- [ ] Truncated-banner если backend вернул `truncated: true` (как в web `TrackTruncatedBanner`).
- [ ] Empty state: «Точек за <дата> нет».

### Этап 6: Родительский контроль (embed)

**Коммит:** `feat(child-detail): parental control via WebView embed`
**Дней:** 0.5

- [ ] Новая web-страница: `apps/web/app/embed/parental-control/[childId]/page.tsx`:
  - Аналогично `apps/web/app/embed/audio/[childId]/page.tsx` — читает hash `#t=...&n=...&u=...&e=...&f=...&fn=...`
  - Кладёт в `useAuthStore` через `setAll`
  - Чистит hash через `history.replaceState`
  - Рендерит `<ParentalControlClient childId={childId} />` (переиспользуем существующий компонент)
  - `handleClose` → `GmdHost.postMessage('close')` для back-navigation
- [ ] `apps/web/components/children/parental-control-client.tsx` — выделить из `parental-control/page.tsx` если ещё не выделен. Или просто рендерить `<ParentalControlClient>` напрямую если он уже компонент.
- [ ] Mobile: `ParentalControlScreen` — копия `AudioListenScreen`, URL: `$webOrigin/embed/parental-control/<childId>#t=...`
- [ ] Маршрут: `/home/child/:id/parental-control`
- [ ] При тапе ListTile «Родительский контроль» → `context.push('/home/child/${child.id}/parental-control')`
- [ ] Web-side: убедиться что `ParentalControlClient` не использует Radix `DialogTitle/Header/Description/Footer` без `Dialog.Root` (та же проблема что была с AudioSessionPane v0.46.0). Если использует — извлечь в plain HTML (как в `audio-listen-dialog.tsx`).

### Этап 7: CHANGELOG + release v0.50.0

**Коммит:** `chore: release v0.50.0`
**Дней:** 0.3

- [ ] Заполнить CHANGELOG.md блок `## v0.50.0 — 2026-04-XX`:
  - Новые возможности: history, parental-control (embed), reset-device, delete-child, status-card, collapsible-sheet
  - Улучшения: protection toggle (был только на web)
  - Изменения: bottom-panel redesign (4 плитки → vertical list)
- [ ] `npm version 0.50.0 --no-git-tag-version --workspaces=false`
- [ ] `pnpm version:sync` + `pnpm version:check`
- [ ] mobile-parent: bump `pubspec.yaml` build number `+18`
- [ ] `git commit -m "chore: release v0.50.0"` + `git tag v0.50.0` + push
- [ ] `bash infra/deploy/deploy.sh` (web нужен для embed/parental-control)
- [ ] `cd apps/mobile-parent && flutter build apk --release && adb install -r ...` на 192.168.77.154
- [ ] Smoke-test на устройстве:
  - Состояние карточки на свернутом sheet
  - Развернуть sheet swipe'ом, проверить все 7 тайлов
  - Защита: toggle ON → дождаться FCM → проверить на child устройстве
  - Отвязать → новый QR появляется в инвайтах
  - История → выбрать дату с трекингом, увидеть polyline
  - Родительский контроль → embed открывается, viewable, кнопка close работает через JS-bridge

## Итого ≈ 3-4 дня эффективного времени

## Известные риски

1. **flutter_map в DraggableScrollableSheet может рассинхронизироваться с rebuild'ами** — проверить `MapController` survival при анимации sheet'а. Если будет дёргаться — wrap карту в `KeyedSubtree`.
2. **AppBar overflow** на узких устройствах — кнопка ⋮ + название имя должны fit. Если нет — убрать `actions` button и переместить «Редактировать» в bottom-sheet.
3. **Web embed parental-control** может оказаться не выделен в re-usable компонент — придётся рефакторить `parental-control-client.tsx`. Заложил 0.5 дня, может вырасти до 1.
4. **Radix Dialog primitives в parental-control page** — если упадут как с audio-dialog v0.46.0, придётся срочно фиксить web (`fix(web): plain HTML вместо Radix Dialog primitives в ParentalControl`).
5. **Block sessions через embed** — `BlockDialog` в web использует `Dialog.Root` (полноценный). В embed это OK, но нужно проверить что back-button mobile корректно обрабатывает закрытие диалога (не закроет всю WebView вместо диалога).

## Open vs blocked

- **Не блокирует ничего из текущего MVP** — экран ребёнка работает (Сигнал + Звук). Это улучшение.
- **Перед началом**: ничего, можно стартовать с этапа 1.
- **iOS поддержка** — не входит в этот план. Маршруты и виджеты будут OK на iOS, но push-обработка и `webview_flutter` quirks (autoplay, mediaPlaybackRequiresUserGesture) — отдельная задача.

## После завершения

- `save_decision` в memory-compiler: «Hybrid native + WebView embed для child-detail screen v0.50.0»
- Обновить `docs/engineering/PROJECT.md`:
  - Раздел Mobile-parent → добавить новые экраны (history, parental-control, status-card)
  - ADR §6 «WebView Embed Pattern» → добавить parental-control как второй пример
- `finish_task` в memory-compiler с описанием делать
