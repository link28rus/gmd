import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';

describe('Children + Invites (e2e)', () => {
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

  async function registerParent(
    email: string,
  ): Promise<{ accessToken: string; familyId: string; userId: string }> {
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const code = h.delivery.lastCodeFor(email);
    if (!code) throw new Error('no code');
    const v = await request(server).post('/auth/verify-otp').send({ email, code }).expect(200);
    return {
      accessToken: v.body.accessToken,
      familyId: v.body.family.id,
      userId: v.body.user.id,
    };
  }

  it('CRUD ребёнка + инвайт + список через /me', async () => {
    const server = h.app.getHttpServer();
    const { accessToken } = await registerParent('parent@x.com');
    const auth = { Authorization: `Bearer ${accessToken}` };

    const create = await request(server)
      .post('/family/children')
      .set(auth)
      .send({ name: 'Ваня' })
      .expect(201);
    const childId = create.body.child.id;
    expect(create.body.child.name).toBe('Ваня');

    const list = await request(server).get('/family/children').set(auth).expect(200);
    expect(list.body.children).toHaveLength(1);
    expect(list.body.children[0].device).toBeNull();

    const patch = await request(server)
      .patch(`/family/children/${childId}`)
      .set(auth)
      .send({ name: 'Иван' })
      .expect(200);
    expect(patch.body.child.name).toBe('Иван');

    const inv = await request(server)
      .post(`/family/children/${childId}/invites`)
      .set(auth)
      .expect(201);
    expect(inv.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(inv.body.qrUrl).toContain(`/claim/${inv.body.code}`);
    expect(inv.body.expiresIn).toBe(600);

    const me = await request(server).get('/me').set(auth).expect(200);
    expect(me.body.children).toHaveLength(1);
    expect(me.body.children[0].device).toBeNull();

    await request(server).delete(`/family/children/${childId}`).set(auth).expect(204);
    const listAfter = await request(server).get('/family/children').set(auth).expect(200);
    expect(listAfter.body.children).toHaveLength(0);
  });

  it('409 при повторном invite если у child уже есть device', async () => {
    const server = h.app.getHttpServer();
    const { accessToken } = await registerParent('p2@x.com');
    const auth = { Authorization: `Bearer ${accessToken}` };
    const create = await request(server)
      .post('/family/children')
      .set(auth)
      .send({ name: 'A' })
      .expect(201);
    const childId = create.body.child.id;

    const inv = await request(server)
      .post(`/family/children/${childId}/invites`)
      .set(auth)
      .expect(201);

    await request(server).post('/child/claim').send({ code: inv.body.code }).expect(200);

    const second = await request(server)
      .post(`/family/children/${childId}/invites`)
      .set(auth)
      .expect(409);
    expect(second.body.error.code).toBe('child_has_device');

    await request(server).post(`/family/children/${childId}/reset-device`).set(auth).expect(204);

    await request(server).post(`/family/children/${childId}/invites`).set(auth).expect(201);
  });

  it('parent не видит child чужой семьи (404)', async () => {
    const server = h.app.getHttpServer();
    const a = await registerParent('alice@x.com');
    const b = await registerParent('bob@x.com');
    const create = await request(server)
      .post('/family/children')
      .set({ Authorization: `Bearer ${a.accessToken}` })
      .send({ name: 'Alice-Child' })
      .expect(201);
    const childId = create.body.child.id;

    await request(server)
      .patch(`/family/children/${childId}`)
      .set({ Authorization: `Bearer ${b.accessToken}` })
      .send({ name: 'Hack' })
      .expect(404);

    await request(server)
      .delete(`/family/children/${childId}`)
      .set({ Authorization: `Bearer ${b.accessToken}` })
      .expect(404);
  });
});
