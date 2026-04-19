import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';

const DEV_SECRET = 'test-dev-secret-32bytes-padding-x';

describe('Auth password (e2e)', () => {
  let h: TestAppHandle;

  beforeAll(async () => {
    process.env.AUTH_DEV_MODE = 'true';
    process.env.AUTH_DEV_SECRET = DEV_SECRET;
    process.env.PASSWORD_LOCK_AFTER = '5';
    process.env.PASSWORD_LOCK_TTL_SECONDS = '900';
    h = await bootTestApp();
  }, 180_000);

  afterAll(async () => {
    await h.close();
    delete process.env.AUTH_DEV_MODE;
    delete process.env.AUTH_DEV_SECRET;
  });

  beforeEach(async () => {
    await truncateAll(h);
  });

  const server = () => h.app.getHttpServer();

  // ── dev/set-password guards ─────────────────────────────────────────────────

  it('dev/set-password without AUTH_DEV_MODE → 404', async () => {
    // Override within the running app (env was set before boot, so we test
    // the route by temporarily changing env and making a new request)
    const origMode = process.env.AUTH_DEV_MODE;
    process.env.AUTH_DEV_MODE = 'false';
    await request(server())
      .post('/auth/dev/set-password')
      .set('X-Auth-Dev-Secret', DEV_SECRET)
      .send({ email: 'test@x.com', password: 'password123' })
      .expect(404);
    process.env.AUTH_DEV_MODE = origMode;
  });

  it('dev/set-password with wrong secret → 404', async () => {
    await request(server())
      .post('/auth/dev/set-password')
      .set('X-Auth-Dev-Secret', 'wrong-secret')
      .send({ email: 'test@x.com', password: 'password123' })
      .expect(404);
  });

  it('dev/set-password OK → 204 (creates user)', async () => {
    await request(server())
      .post('/auth/dev/set-password')
      .set('X-Auth-Dev-Secret', DEV_SECRET)
      .send({ email: 'devuser@x.com', password: 'devPassword1' })
      .expect(204);

    const user = await h.prisma.user.findUnique({ where: { email: 'devuser@x.com' } });
    expect(user).not.toBeNull();
    expect(user?.passwordHash).toBeTruthy();
  });

  // ── login-password ──────────────────────────────────────────────────────────

  it('login-password correct → 200 + tokens', async () => {
    await request(server())
      .post('/auth/dev/set-password')
      .set('X-Auth-Dev-Secret', DEV_SECRET)
      .send({ email: 'login@x.com', password: 'correctPass1' })
      .expect(204);

    const res = await request(server())
      .post('/auth/login-password')
      .send({ email: 'login@x.com', password: 'correctPass1' })
      .expect(200);

    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('login@x.com');
  });

  it('login-password wrong × 5 → 401, 6th → 423 account_locked', async () => {
    await request(server())
      .post('/auth/dev/set-password')
      .set('X-Auth-Dev-Secret', DEV_SECRET)
      .send({ email: 'lockme@x.com', password: 'correctPass1' })
      .expect(204);

    for (let i = 0; i < 5; i++) {
      const res = await request(server())
        .post('/auth/login-password')
        .send({ email: 'lockme@x.com', password: 'wrongPassword' })
        .expect(401);
      expect(res.body.error.code).toBe('invalid_credentials');
    }

    // 6th attempt → locked
    const locked = await request(server())
      .post('/auth/login-password')
      .send({ email: 'lockme@x.com', password: 'wrongPassword' })
      .expect(423);
    expect(locked.body.error.code).toBe('account_locked');
    expect(locked.body.error.retryAfterSec).toBeGreaterThan(0);
  });

  it('successful login resets lock counter', async () => {
    await request(server())
      .post('/auth/dev/set-password')
      .set('X-Auth-Dev-Secret', DEV_SECRET)
      .send({ email: 'resetlock@x.com', password: 'correctPass1' })
      .expect(204);

    // 3 wrong attempts
    for (let i = 0; i < 3; i++) {
      await request(server())
        .post('/auth/login-password')
        .send({ email: 'resetlock@x.com', password: 'wrongPassword' })
        .expect(401);
    }

    // correct login clears counter
    await request(server())
      .post('/auth/login-password')
      .send({ email: 'resetlock@x.com', password: 'correctPass1' })
      .expect(200);

    // now can fail 5 more times before lock (counter was reset)
    for (let i = 0; i < 4; i++) {
      await request(server())
        .post('/auth/login-password')
        .send({ email: 'resetlock@x.com', password: 'wrongPassword' })
        .expect(401);
    }
    // 5th fail → still 401 (not locked yet)
    await request(server())
      .post('/auth/login-password')
      .send({ email: 'resetlock@x.com', password: 'wrongPassword' })
      .expect(401);

    // 6th → now locked
    await request(server())
      .post('/auth/login-password')
      .send({ email: 'resetlock@x.com', password: 'wrongPassword' })
      .expect(423);
  });

  it('set-password (JwtAuthGuard) → changes password → login with new password OK', async () => {
    const email = 'changepwd@x.com';

    // Create user via OTP first to get a token
    await request(server()).post('/auth/request-otp').send({ email }).expect(202);
    const code = h.delivery.lastCodeFor(email);
    expect(code).toBeTruthy();

    const otpRes = await request(server())
      .post('/auth/verify-otp')
      .send({ email, code })
      .expect(200);

    const accessToken = otpRes.body.accessToken as string;

    // Set password using JWT-protected endpoint
    await request(server())
      .post('/auth/set-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'newSecurePass1' })
      .expect(204);

    // Login with new password
    const loginRes = await request(server())
      .post('/auth/login-password')
      .send({ email, password: 'newSecurePass1' })
      .expect(200);

    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.user.email).toBe(email);
  });
});
