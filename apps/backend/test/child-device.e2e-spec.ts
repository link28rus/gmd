import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';

describe('Child Device (e2e)', () => {
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

  async function setupChildAndInvite(): Promise<{
    accessToken: string;
    childId: string;
    code: string;
  }> {
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email: 'parent@x.com' }).expect(202);
    const otp = h.delivery.lastCodeFor('parent@x.com');
    if (!otp) throw new Error('no otp');
    const v = await request(server)
      .post('/auth/verify-otp')
      .send({ email: 'parent@x.com', code: otp })
      .expect(200);
    const auth = { Authorization: `Bearer ${v.body.accessToken}` };
    const create = await request(server)
      .post('/family/children')
      .set(auth)
      .send({ name: 'V' })
      .expect(201);
    const inv = await request(server)
      .post(`/family/children/${create.body.child.id}/invites`)
      .set(auth)
      .expect(201);
    return {
      accessToken: v.body.accessToken,
      childId: create.body.child.id,
      code: inv.body.code,
    };
  }

  it('полный flow: claim → /child/me', async () => {
    const server = h.app.getHttpServer();
    const { code } = await setupChildAndInvite();

    const claim = await request(server)
      .post('/child/claim')
      .send({ code, deviceName: 'Pixel 8', osVersion: 'Android 13' })
      .expect(200);
    expect(claim.body.deviceToken).toBeTruthy();
    expect(claim.body.child.name).toBe('V');

    const me = await request(server)
      .get('/child/me')
      .set('X-Child-Token', claim.body.deviceToken)
      .expect(200);
    expect(me.body.child.id).toBe(claim.body.child.id);
  });

  it('replay claim того же кода → 400', async () => {
    const server = h.app.getHttpServer();
    const { code } = await setupChildAndInvite();
    await request(server).post('/child/claim').send({ code }).expect(200);
    const second = await request(server).post('/child/claim').send({ code }).expect(400);
    expect(second.body.error.code).toBe('invite_invalid');
  });

  it('parent reset-device → старый X-Child-Token → 401', async () => {
    const server = h.app.getHttpServer();
    const { accessToken, childId, code } = await setupChildAndInvite();
    const claim = await request(server).post('/child/claim').send({ code }).expect(200);
    await request(server)
      .post(`/family/children/${childId}/reset-device`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(204);

    await request(server).get('/child/me').set('X-Child-Token', claim.body.deviceToken).expect(401);
  });

  it('DELETE child → X-Child-Token → 401', async () => {
    const server = h.app.getHttpServer();
    const { accessToken, childId, code } = await setupChildAndInvite();
    const claim = await request(server).post('/child/claim').send({ code }).expect(200);
    await request(server)
      .delete(`/family/children/${childId}`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(204);

    await request(server).get('/child/me').set('X-Child-Token', claim.body.deviceToken).expect(401);
  });

  it('invalid code → 400', async () => {
    const server = h.app.getHttpServer();
    const r = await request(server).post('/child/claim').send({ code: 'NOTHING1' }).expect(400);
    expect(r.body.error.code).toBe('invite_invalid');
  });

  it('case-insensitive code (lower-case)', async () => {
    const server = h.app.getHttpServer();
    const { code } = await setupChildAndInvite();
    await request(server).post('/child/claim').send({ code: code.toLowerCase() }).expect(200);
  });
});
