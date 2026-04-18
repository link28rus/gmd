# GMD Admin — Read-only панель администратора

**Дата:** 2026-04-19
**Фаза:** admin-ro (вне основного roadmap Phase 1.x, боковая задача)
**Зависит от:** Phase 1.1 (Auth), Phase 1.2 (Children).

## Цель

Административная read-only страница `/admin` для владельца сервиса: увидеть кто зарегистрировался, сколько семей, сколько детей, какие устройства подключены, какие инвайты активны. Без мутаций — на случай первых бета-пользователей для ручного контроля, не для модерации.

## Scope

**Входит:**

- Env `ADMIN_EMAILS` — comma-separated whitelist.
- `AdminGuard` backend — после `JwtAuthGuard`. Проверяет `user.email ∈ ADMIN_EMAILS` case-insensitive.
- Backend endpoints (все read-only, Jwt+Admin):
  - `GET /admin/users?page=1&limit=50&q=email-substring` — список юзеров с пагинацией и поиском
  - `GET /admin/users/:id` — детали одного юзера (семья, членства, дети, статистика)
  - `GET /admin/families?page=1&limit=50` — список семей с кол-вом детей/устройств/юзеров
  - `GET /admin/children?page=1&limit=50` — все дети всех семей
  - `GET /admin/invites?active=true` — активные (непотреблённые, не истёкшие) инвайты
  - `GET /admin/stats` — общая сводка (пользователей, семей, детей, активных устройств)
- Web `/admin/*` с отдельным layout (красная шапка «Режим администратора»):
  - `/admin` — dashboard со stats
  - `/admin/users` — таблица
  - `/admin/families` — таблица
  - `/admin/children` — таблица
  - `/admin/invites` — таблица
- `GET /me` → возвращает поле `isAdmin: boolean`.
- В шапке кабинета — ссылка «Админка» если `me.isAdmin=true`.
- Unit-тесты для AdminGuard и каждого endpoint'а.

**Не входит:**

- Любые мутации (`DELETE`, `PATCH`) — отдельная фаза при появлении кейсов модерации.
- Audit-log.
- Графики/метрики (будут в Grafana Phase 0.4).
- Экспорт в CSV/Excel.
- Management админов через UI — только env.

## Решения

| Вопрос         | Решение                                             | Почему                                          |
| -------------- | --------------------------------------------------- | ----------------------------------------------- |
| Роль           | Env-whitelist `ADMIN_EMAILS`                        | Без миграций, 1-строчный guard, хватает для MVP |
| Email compare  | `toLowerCase().trim()` на обеих сторонах            | устойчивость к опечаткам                        |
| Scope операций | Read-only                                           | Безопасно, никаких rm -rf                       |
| Список в UI    | Простые HTML-таблицы + поиск для users              | YAGNI на rich data-grid                         |
| Pagination     | `?page=&limit=` offset-based                        | 50 на страницу, простая, данных мало            |
| Web auth       | То же что cabinet — refresh cookie + Zustand access | Не плодим новый auth-пайплайн                   |
| isAdmin в /me  | Да, вычисляется на backend                          | Клиент знает сразу после login                  |
| Шапка          | Красная полоса сверху, отдельный layout             | Визуально ясно что это опасная зона             |

## Архитектура

### Backend

```
apps/backend/src/
├── admin/
│   ├── admin.module.ts
│   ├── admin.service.ts             методы list/detail
│   ├── admin.service.spec.ts
│   ├── admin.controller.ts          GET endpoints с guards
│   ├── guards/
│   │   ├── admin.guard.ts
│   │   └── admin.guard.spec.ts
│   ├── dto/pagination.dto.ts        Zod
│   └── ADMIN_CONFIG (Symbol), interface AdminConfig { emails: string[] }
├── users/users.service.ts           MODIFY: getMe включает isAdmin
└── app.module.ts                    MODIFY: + AdminModule
```

### AdminGuard

```typescript
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_CONFIG) private cfg: AdminConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { email?: string } | undefined;
    if (!user?.email) throw new ForbiddenException({ code: 'forbidden', message: 'Admin only' });
    const email = user.email.toLowerCase().trim();
    if (!this.cfg.emails.includes(email)) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Admin only' });
    }
    return true;
  }
}
```

Конфиг через useFactory: `emails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.toLowerCase().trim()).filter(Boolean)`.

### Endpoints (ответы)

```
GET /admin/stats
  200: {
    users:      { total: number, deleted: number },
    families:   { total: number },
    children:   { total: number, deleted: number },
    devices:    { total: number, active: number, revoked: number },
    invites:    { total: number, activeNow: number }
  }

GET /admin/users?page=1&limit=50&q=foo
  200: {
    items: [{ id, email, name, locale, acceptedPrivacyPolicyVersion,
              createdAt, deletedAt, familyId, familyName, childrenCount }],
    page, limit, total
  }

GET /admin/users/:id
  200: {
    user: { id, email, name, locale, createdAt, updatedAt, deletedAt,
            acceptedPrivacyPolicyVersion },
    memberships: [{ familyId, familyName, role }],
    children: [{ id, name, dateOfBirth, hasDevice, deviceLastSeenAt }],
    refreshTokensActive: number,
    otpCodesActiveLast24h: number
  }
  404: если user не найден

GET /admin/families?page=1&limit=50
  200: { items: [{ id, name, createdAt, membersCount, childrenCount,
                    activeDevicesCount }], page, limit, total }

GET /admin/children?page=1&limit=50
  200: { items: [{ id, name, dateOfBirth, familyId, familyName,
                    deviceStatus, deviceLastSeenAt, deletedAt }],
         page, limit, total }

GET /admin/invites?active=true
  200: { items: [{ id, code, childId, childName, familyId, familyName,
                    expiresAt, consumedAt, createdAt, createdByEmail }] }
```

### Web

```
apps/web/
├── app/
│   ├── admin/
│   │   ├── layout.tsx                 NEW: server-side guard (re-fetch /me.isAdmin) + red header
│   │   ├── page.tsx                   NEW: dashboard /admin (stats)
│   │   ├── users/page.tsx             NEW: список
│   │   ├── users/[id]/page.tsx        NEW: детали
│   │   ├── families/page.tsx          NEW
│   │   ├── children/page.tsx          NEW
│   │   └── invites/page.tsx           NEW
│   └── api/
│       └── admin/
│           ├── stats/route.ts         NEW: proxy
│           ├── users/route.ts
│           ├── users/[id]/route.ts
│           ├── families/route.ts
│           ├── children/route.ts
│           └── invites/route.ts
├── components/
│   └── admin/
│       ├── admin-header.tsx           NEW: красная полоса
│       └── data-table.tsx             NEW: простая таблица с header
├── lib/
│   └── api/admin.ts                   NEW: типы + методы
└── lib/hooks/use-admin.ts             NEW: React Query hooks

Cabinet-header:
- MODIFY: ссылка «Админка» видна если me.isAdmin
```

### Caddy

Добавить `/api/admin/*` в routing на web (прокси с Bearer):

```
handle /api/admin/* {
  reverse_proxy web:3000
}
```

### /me расширение

```
GET /me
  200: { user, family, memberships, children, isAdmin: boolean }
```

Вычисление `isAdmin`: `user.email.toLowerCase() ∈ ADMIN_EMAILS`.

## Tests

**Backend unit:**

- `admin.guard.spec.ts` — нет user, не-админ email, админ email, case-insensitive.
- `admin.service.spec.ts` — list/count/details по тестовым данным.

**Backend e2e:**

- `admin.e2e-spec.ts` — обычный юзер 403 на /admin/\*, админ-юзер (env override) 200. Pagination работает.

**Web smoke (Playwright опционально):**

- `/admin` 302 /login для не-залогиненого.
- `/admin` 403/redirect для не-админа.
- `/admin` 200 + stats для админа.

## Env

```
ADMIN_EMAILS=link28rus@gmail.com
```

Добавить в `apps/backend/.env.example` и `infra/docker/docker-compose.prod.yml`. На prod сразу прописать в `.env.prod` свой email.

## Критерии приёмки

- [ ] `pnpm --filter @gmd/backend test` зелёно (+10 unit).
- [ ] `/admin/*` без админ-email → 403.
- [ ] С админ-email в ADMIN_EMAILS → все 6 endpoint'ов возвращают данные.
- [ ] Web `/admin` виден только с `me.isAdmin=true`, ссылка в шапке появилась.
- [ ] Таблицы работают, поиск по email на /admin/users фильтрует.
- [ ] CHANGELOG v0.7.0 (учтём что 1.2.5 откладывается).
- [ ] Deploy на prod + smoke.

## Открытые вопросы

1. Название фичи в CHANGELOG: «Админ-панель MVP» или «Режим администратора». Рекомендую первое.
2. Phase 1.2.5 (privacy) и password-auth — в паузе. Админка идёт раньше по запросу. Вернёмся после.
3. Audit-log — не сейчас. В файле admin.service добавлю `logger.log('admin access: ...')` с email действия — минимальный аудит через серверные логи.
