# GMD — Вход по паролю (password-auth)

**Дата:** 2026-04-19
**Фаза:** auth-password (боковая задача параллельно с Phase 1.2.5/1.3)
**Зависит от:** Phase 1.1 (Auth — JWT, refresh, OTP).

## Цель

Дать родителю возможность входить в web-кабинет по email + паролю, не дожидаясь письма с OTP каждый раз. OTP остаётся как fallback и механизм восстановления пароля. Задаём пароль через существующую сессию (уже залогинен по OTP) или через dev-endpoint без OTP (для self-hosted первой настройки).

## Scope

**Входит:**

- `User.passwordHash: String?` — миграция.
- `@node-rs/argon2` для hash/verify (уже в deps — `/auth/*` использует для OTP).
- `POST /auth/login-password` — вход по email+password, выдаёт ту же JWT+refresh пару что `/auth/verify-otp`. Rate-limit 10/10 min/IP.
- `POST /auth/set-password` (JwtAuthGuard) — задать/изменить пароль для текущего юзера.
- `POST /auth/dev/set-password` — задать пароль для произвольного email, только при `AUTH_DEV_MODE=true` и с header `X-Auth-Dev-Secret` равным env `AUTH_DEV_SECRET`. Используется для первой установки пароля на self-hosted prod без SMTP.
- Redis-счётчик неудач: 5 подряд → 15-min lock (423 `account_locked`).
- Timing-safe compare через `argon2.verify`.
- Web: на `/login` две вкладки «По коду» (OTP, существующая) / «По паролю» (новая).
- Web: `PasswordLoginForm` + API prox `/api/auth/login-password`.
- Unit + e2e тесты.
- CHANGELOG v0.8.0.

**Не входит** (следующие фазы):

- UI «Задать пароль» в кабинете — Phase 1.4 (пока только API).
- Password reset через OTP-email — Phase 1.4 (требует SMTP).
- Смена пароля с вводом текущего — Phase 1.4.
- 2FA/TOTP — не на MVP.
- Breached-password check — YAGNI.
- Password strength meter — YAGNI.

## Решения

| Вопрос         | Решение                                                          | Почему                                                                                                |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Алгоритм       | argon2id (`@node-rs/argon2`)                                     | Уже в проекте, победитель Password Hashing Competition                                                |
| Min length     | 8, max 128                                                       | NIST SP 800-63B: длина важнее сложности, не требуем спецсимволов                                      |
| OTP сохраняем? | Да, как fallback                                                 | Не ломаем существующий flow, юзеры могут войти даже если забыли пароль                                |
| Generic error  | 401 `invalid_credentials` на все неудачи                         | Анти-enumeration (не говорим что email не найден или пароль неверный отдельно)                        |
| Lock           | 5 неудач подряд → 15 min Redis-lock                              | Rate-limit не защитит если один IP атакует много emails; per-email lock покрывает credential stuffing |
| Timing         | `argon2.verify` сам timing-safe + min delay 150ms на 401         | Verify быстрый (~50-100ms), доп. 150ms гарантирует stable latency                                     |
| Dev endpoint   | `/auth/dev/set-password` + `AUTH_DEV_MODE` + `X-Auth-Dev-Secret` | Защита от случайного включения: нужны ДВА флага (env on + secret header)                              |
| Web UI         | Вкладки на `/login`                                              | Минимальная переделка, оба способа видны                                                              |
| Session flow   | Один JWT+refresh на оба способа                                  | Backend не знает после issue, как юзер вошёл                                                          |

## Архитектура

### Данные (Prisma)

```prisma
model User {
  // ... существующие поля
  passwordHash String?  // @node-rs/argon2 hash
}
```

Миграция `add_user_password_hash`.

### API

```
POST /auth/login-password
  body:   { email: string, password: string }
  200:    { accessToken, refreshToken, user: {id, email, name, locale}, family: {id, name} }
          (такой же шейп как /auth/verify-otp)
  401 invalid_credentials:  email не найден ИЛИ passwordHash IS NULL ИЛИ пароль не совпал
  423 account_locked:       5 неудач подряд — ждать до `retryAfterSec`
                             (response: { error: { code: 'account_locked', message, retryAfterSec: 900 } })
  429:                      rate-limit 10/10min/IP

POST /auth/set-password   (JwtAuthGuard)
  body:   { password: string (8..128) }
  204:    обновляет User.passwordHash
  400 password_invalid:     <8 или >128 символов

POST /auth/dev/set-password
  headers: X-Auth-Dev-Secret: <secret>
  body:   { email: string, password: string (8..128) }
  204:    если User не существует, создаёт (email + default family через existing flow); ставит passwordHash
  400 password_invalid
  404 not_available:        если AUTH_DEV_MODE != true ИЛИ secret не совпал ИЛИ заголовок отсутствует
                             (всегда 404 а не 403 — hide endpoint при выключенном режиме)
```

### Backend структура

```
apps/backend/src/auth/
├── auth.service.ts                        MODIFY: + loginWithPassword, setPassword, devSetPassword, ensureUserAndFamily
├── auth.controller.ts                     MODIFY: + 3 новых route
├── password.service.ts                    NEW: hash, verify, lock counter (Redis)
├── password.service.spec.ts               NEW
└── dto/
    ├── login-password.dto.ts              NEW: Zod {email, password}
    ├── set-password.dto.ts                NEW: Zod {password}
    └── dev-set-password.dto.ts            NEW: Zod {email, password}
```

### PasswordService

```typescript
@Injectable()
export class PasswordService {
  constructor(
    private readonly redis: RedisService,
    @Inject(PASSWORD_CONFIG) private cfg: PasswordConfig,
  ) {}

  async hash(plain: string): Promise<string> {
    return hash(plain);
  }
  async verify(hash: string, plain: string): Promise<boolean> {
    return argonVerify(hash, plain);
  }

  async recordFailure(email: string): Promise<{ locked: boolean; retryAfterSec: number }> {
    const key = `pwlock:${email.toLowerCase()}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, this.cfg.lockTtlSec);
    const locked = n >= this.cfg.lockAfter;
    const retry = locked ? await this.redis.ttl(key) : 0;
    return { locked, retryAfterSec: retry };
  }
  async isLocked(email: string): Promise<{ locked: boolean; retryAfterSec: number }> {
    const key = `pwlock:${email.toLowerCase()}`;
    const n = Number((await this.redis.get(key)) ?? 0);
    const locked = n >= this.cfg.lockAfter;
    const retry = locked ? await this.redis.ttl(key) : 0;
    return { locked, retryAfterSec: retry };
  }
  async clearFailures(email: string): Promise<void> {
    await this.redis.del(`pwlock:${email.toLowerCase()}`);
  }
}
```

### AuthService расширение

```typescript
async loginWithPassword(email: string, password: string, meta: TokenMeta): Promise<LoginResult> {
  const lock = await this.password.isLocked(email);
  if (lock.locked) throw new LockedException('account_locked', lock.retryAfterSec);

  const user = await this.prisma.user.findUnique({ where: { email }, include: { memberships: { include: { family: true } } } });
  const hashToVerify = user?.passwordHash ?? DUMMY_HASH;  // timing-parity для несуществующих юзеров
  const ok = user?.passwordHash && await this.password.verify(hashToVerify, password);
  if (!ok || user?.deletedAt) {
    await this.password.recordFailure(email);
    await sleep(150);  // timing floor
    throw new UnauthorizedException({ code: 'invalid_credentials', message: 'Invalid email or password' });
  }

  await this.password.clearFailures(email);
  return this.issueTokens(user, meta);   // переиспользует существующий код
}

async setPassword(userId: string, password: string): Promise<void> {
  const hash = await this.password.hash(password);
  await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
}

async devSetPassword(email: string, password: string): Promise<void> {
  const existing = await this.prisma.user.findUnique({ where: { email } });
  const hash = await this.password.hash(password);
  if (existing) {
    await this.prisma.user.update({ where: { id: existing.id }, data: { passwordHash: hash } });
  } else {
    // ensureUserAndFamily — извлечь из verifyOtp существующую логику создания юзера+семьи
    await this.ensureUserAndFamilyWithPassword(email, hash);
  }
}
```

`DUMMY_HASH` — pre-computed argon2 hash от случайной строки, на старте приложения. Гарантирует равную длительность verify для существующих и несуществующих юзеров.

### Controller

```typescript
@Post('login-password')
@Throttle({ default: { limit: 10, ttl: 600_000 } })
async loginPassword(@Body() body: LoginPasswordDto, @Req() req) {
  return this.authService.loginWithPassword(body.email, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
}

@Post('set-password')
@UseGuards(JwtAuthGuard)
async setPwd(@Body() body: SetPasswordDto, @Req() req) {
  await this.authService.setPassword(req.user.sub, body.password);
  return; // 204
}

@Post('dev/set-password')
async devSetPwd(@Body() body: DevSetPasswordDto, @Headers('x-auth-dev-secret') secret: string | undefined) {
  if (process.env.AUTH_DEV_MODE !== 'true') throw new NotFoundException();
  if (!secret || secret !== process.env.AUTH_DEV_SECRET) throw new NotFoundException();
  await this.authService.devSetPassword(body.email, body.password);
  return; // 204
}
```

### Web (apps/web)

**Изменения:**

- `apps/web/app/login/page.tsx` MODIFY:
  - Добавить state `loginMode: 'otp' | 'password'`
  - Табы вверху формы (toggle buttons): «По коду из письма» / «По паролю»
  - При `password` — форма email + password + кнопка «Войти» → POST `/api/auth/login-password`
  - При `otp` — существующая двухстадийная форма
- `apps/web/app/api/auth/login-password/route.ts` NEW:
  - Аналог verify-otp/route.ts: проксирует в backend, ставит `gmd_refresh` cookie, возвращает accessToken + user + family
- `apps/web/components/login/password-login-form.tsx` NEW (опционально — либо inline в page.tsx)

Типы client-side — простые, без React Query (login это не permanent query).

### Env

```
AUTH_DEV_MODE=false              # на prod для первой установки пароля: true, потом обратно false
AUTH_DEV_SECRET=                 # случайный 32-byte string; без него endpoint недоступен даже при AUTH_DEV_MODE=true
PASSWORD_LOCK_AFTER=5
PASSWORD_LOCK_TTL_SECONDS=900
```

Добавить в `.env.example` и `docker-compose.prod.yml`.

## Security

- **Enumeration defense:** одинаковый 401 для всех неудач + DUMMY_HASH для несуществующих юзеров + min-delay 150ms.
- **Credential stuffing:** per-email Redis-lock после 5 неудач.
- **Brute-force:** rate-limit 10/10min/IP + lock.
- **Timing:** argon2.verify + 150ms floor.
- **Dev-endpoint:** 2 уровня защиты (env flag + secret header). Secret 32 bytes random. Всегда 404 если любое не совпало.
- **Pwd storage:** argon2id hash (default params: t=3 iterations, m=64MB, p=4).
- **Pwd transport:** только HTTPS на prod (Caddy TLS). На HTTP — secure cookie блокирует session (отдельный бонус).

## Testing

### Unit

**password.service.spec.ts:**

- `hash` → `verify(hash, plain) === true`.
- `verify(hash, 'wrong') === false`.
- `recordFailure` инкрементит счётчик.
- После N=5 `isLocked.locked === true`.
- `clearFailures` сбрасывает.
- TTL устанавливается на первом incr.

**auth.service.spec.ts расширение:**

- `loginWithPassword` успех → issueTokens возвращает пару.
- Email не найден → 401 + recordFailure.
- Email найден без passwordHash → 401.
- Email найден, пароль неверный → 401 + recordFailure.
- 5-я попытка неверным паролем → locked на 6-й.
- Успех сбрасывает counter.
- Пользователь с `deletedAt != null` → 401.
- `setPassword` обновляет hash юзера.
- `devSetPassword` создаёт юзера если не было.
- `devSetPassword` обновляет hash существующего.

### E2E

**auth-password.e2e-spec.ts:**

- Dev set-password без AUTH_DEV_MODE → 404.
- Dev set-password с неверным secret → 404.
- Dev set-password OK → 204 → login-password с тем же email+pass → 200 + tokens.
- Login-password wrong → 401 + атрибут attempt.
- 5 wrong → 423 account_locked на 6-м.
- set-password (под JwtAuthGuard из OTP-login) → смена пароля → login-password новым паролем OK.

## Критерии приёмки

- [ ] `pnpm --filter @gmd/backend test` зелёно (+15 unit).
- [ ] `pnpm --filter @gmd/backend test:e2e` зелёно.
- [ ] Prisma миграция `add_user_password_hash` применена.
- [ ] curl smoke:
  - `curl -X POST /auth/dev/set-password -H 'X-Auth-Dev-Secret: ...' -d '{...}'` → 204
  - `curl -X POST /auth/login-password -d '{...}'` → 200 + tokens
  - Повторный login неверным → 5 раз 401, 6-й → 423
- [ ] Web `/login` показывает вкладки, password-tab работает.
- [ ] CHANGELOG v0.8.0.
- [ ] Deploy на prod, set-password с dev-secret, вход по паролю работает.
- [ ] После подтверждения работы: выключить `OTP_FIXED_DEV`, `OTP_LOG_DEV`, `AUTH_DEV_MODE` на prod.

## Открытые вопросы

1. Как реагировать если юзер пытается login-password для email которого нет в БД — создавать или возвращать 401? Решено: **401 без создания** (enumeration defense). Юзер должен сначала зарегаться через OTP.
2. Zod min/max — 8/128. Менять? Нет, OK.
3. Один refresh на оба способа входа — OK, tokens взаимозаменяемые.
4. На self-hosted prod как доставить `AUTH_DEV_SECRET`? Генерировать через `openssl rand -hex 32`, класть в `.env.prod`, использовать один раз для set-password, потом `AUTH_DEV_MODE=false`.
