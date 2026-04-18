import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';

describe('Auth (e2e)', () => {
  let h: TestAppHandle;

  beforeAll(async () => {
    h = await bootTestApp();
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
  });

  function getCode(email: string): string {
    const code = h.delivery.lastCodeFor(email);
    if (!code) throw new Error(`no code for ${email}`);
    return code;
  }

  it('full flow: request-otp → verify-otp → /me → refresh → logout', async () => {
    const email = 'new@user.com';
    const server = h.app.getHttpServer();

    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const code = getCode(email);
    expect(code).toMatch(/^\d{6}$/);

    const v = await request(server).post('/auth/verify-otp').send({ email, code }).expect(200);
    expect(v.body.accessToken).toBeTruthy();
    expect(v.body.refreshToken).toBeTruthy();
    expect(v.body.user.email).toBe(email);
    expect(v.body.family.name).toBe('Моя семья');

    const me = await request(server)
      .get('/me')
      .set('Authorization', `Bearer ${v.body.accessToken}`)
      .expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.memberships[0].role).toBe('owner');

    const refreshed = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(v.body.refreshToken);

    await request(server)
      .post('/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);
  });

  it('replay detection: повторная rotate старого refresh → revoke всей цепочки', async () => {
    const email = 'replay@x.com';
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const v = await request(server)
      .post('/auth/verify-otp')
      .send({ email, code: getCode(email) })
      .expect(200);

    const first = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(200);

    // повторно старый refresh → 401
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(401);

    // новый refresh тоже revoked после replay
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);
  });

  it('invalid code → 400 invalid_code', async () => {
    const email = 'bad@x.com';
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const r = await request(server)
      .post('/auth/verify-otp')
      .send({ email, code: '000000' })
      .expect(400);
    expect(r.body.error.code).toBe('invalid_code');
  });

  it('rate limit request-otp: 4-й запрос в окне → 429', async () => {
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email: 'rl1@x.com' }).expect(202);
    await request(server).post('/auth/request-otp').send({ email: 'rl2@x.com' }).expect(202);
    await request(server).post('/auth/request-otp').send({ email: 'rl3@x.com' }).expect(202);
    await request(server).post('/auth/request-otp').send({ email: 'rl4@x.com' }).expect(429);
  });

  it('delete /me → refresh инвалидирован', async () => {
    const email = 'del@x.com';
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const v = await request(server)
      .post('/auth/verify-otp')
      .send({ email, code: getCode(email) })
      .expect(200);

    await request(server)
      .delete('/me')
      .set('Authorization', `Bearer ${v.body.accessToken}`)
      .expect(204);

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(401);
  });
});
