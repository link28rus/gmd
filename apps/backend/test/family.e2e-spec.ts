import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';

describe('Family (e2e)', () => {
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

  it('owner может переименовать свою семью', async () => {
    const email = 'owner@x.com';
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const v = await request(server)
      .post('/auth/verify-otp')
      .send({ email, code: h.delivery.lastCodeFor(email)! })
      .expect(200);

    const r = await request(server)
      .patch(`/family/${v.body.family.id}`)
      .set('Authorization', `Bearer ${v.body.accessToken}`)
      .send({ name: 'Кузнецовы' })
      .expect(200);
    expect(r.body.family.name).toBe('Кузнецовы');
  });
});
