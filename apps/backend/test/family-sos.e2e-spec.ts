import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';

describe('GET /family/sos (e2e)', () => {
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

  it('returns 401 without JWT', async () => {
    const resp = await request(h.app.getHttpServer()).get('/family/sos');
    expect(resp.status).toBe(401);
  });

  it('returns 400 when ?since is not a valid ISO datetime', async () => {
    const parent = await signUpParent(h);
    const resp = await request(h.app.getHttpServer())
      .get('/family/sos?since=not-a-date')
      .set('Authorization', `Bearer ${parent.accessToken}`);
    expect(resp.status).toBe(400);
    const body = resp.body as { error?: { code?: string }; code?: string };
    expect(body.error?.code ?? body.code).toBe('invalid_since');
  });

  it('authed parent sees SOS events from their family', async () => {
    const parent = await signUpParent(h);

    // Seed a child + device + SosEvent in the parent's family
    const child = await h.prisma.child.create({
      data: { familyId: parent.familyId, name: 'Kid' },
    });
    const device = await h.prisma.childDevice.create({
      data: { childId: child.id, tokenHash: 'hash1', deviceName: 'd1' },
    });
    const event = await h.prisma.sosEvent.create({
      data: {
        childId: child.id,
        childDeviceId: device.id,
        lat: 55.7558,
        lon: 37.6173,
        accuracy: 10,
        recordedAt: new Date(),
      },
    });

    const resp = await request(h.app.getHttpServer())
      .get('/family/sos')
      .set('Authorization', `Bearer ${parent.accessToken}`)
      .expect(200);

    expect(resp.body.events).toHaveLength(1);
    expect(resp.body.events[0].id).toBe(event.id);
    expect(resp.body.events[0].childId).toBe(child.id);
    expect(resp.body.events[0].lat).toBeCloseTo(55.7558);
    expect(resp.body.events[0].lon).toBeCloseTo(37.6173);
    expect(resp.body.events[0].acknowledgedAt).toBeNull();
    expect(typeof resp.body.events[0].serverCreatedAt).toBe('string');
  });

  it("authed parent does NOT see another family's SOS events", async () => {
    const parentA = await signUpParent(h, 'parentA@x.com');
    const parentB = await signUpParent(h, 'parentB@x.com');

    // Seed SOS in family A
    const childA = await h.prisma.child.create({
      data: { familyId: parentA.familyId, name: 'Kid A' },
    });
    const deviceA = await h.prisma.childDevice.create({
      data: { childId: childA.id, tokenHash: 'hashA', deviceName: 'dA' },
    });
    await h.prisma.sosEvent.create({
      data: {
        childId: childA.id,
        childDeviceId: deviceA.id,
        lat: 55,
        lon: 37,
        recordedAt: new Date(),
      },
    });

    // Auth as parent B — should get empty
    const resp = await request(h.app.getHttpServer())
      .get('/family/sos')
      .set('Authorization', `Bearer ${parentB.accessToken}`)
      .expect(200);

    expect(resp.body.events).toEqual([]);
  });

  it('?since filter returns only events at-or-after the cutoff', async () => {
    const parent = await signUpParent(h);
    const child = await h.prisma.child.create({
      data: { familyId: parent.familyId, name: 'Kid' },
    });
    const device = await h.prisma.childDevice.create({
      data: { childId: child.id, tokenHash: 'hashS', deviceName: 'ds' },
    });

    const oldDate = new Date(Date.now() - 10 * 60_000); // 10 min ago
    const newDate = new Date(Date.now() - 10_000); // 10 s ago

    await h.prisma.sosEvent.create({
      data: {
        childId: child.id,
        childDeviceId: device.id,
        lat: 1,
        lon: 1,
        recordedAt: oldDate,
        serverCreatedAt: oldDate,
      },
    });
    const newEvent = await h.prisma.sosEvent.create({
      data: {
        childId: child.id,
        childDeviceId: device.id,
        lat: 2,
        lon: 2,
        recordedAt: newDate,
        serverCreatedAt: newDate,
      },
    });

    const cutoff = new Date(Date.now() - 60_000).toISOString(); // 1 min ago

    const resp = await request(h.app.getHttpServer())
      .get(`/family/sos?since=${encodeURIComponent(cutoff)}`)
      .set('Authorization', `Bearer ${parent.accessToken}`)
      .expect(200);

    expect(resp.body.events).toHaveLength(1);
    expect(resp.body.events[0].id).toBe(newEvent.id);
  });
});
