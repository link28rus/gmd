import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';
import { randomBytes, createHash } from 'node:crypto';

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

describe('Ingest → ZoneEvent (e2e)', () => {
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

  async function seedChildAndZone(zoneCenter: { lat: number; lon: number }, radius = 250) {
    const { accessToken, familyId } = await signUpParent(h);

    const child = await h.prisma.child.create({
      data: { familyId, name: 'Аня' },
    });
    const rawToken = randomBytes(32).toString('base64url');
    await h.prisma.childDevice.create({
      data: { childId: child.id, tokenHash: sha256(rawToken), deviceName: 'Test Dev' },
    });

    const zoneRes = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Школа',
        color: '#22c55e',
        icon: 'school',
        centerLat: zoneCenter.lat,
        centerLon: zoneCenter.lon,
        radius,
        childIds: [child.id],
      })
      .expect(201);

    return {
      accessToken,
      deviceToken: rawToken,
      childId: child.id,
      zoneId: zoneRes.body.id as string,
    };
  }

  it('entry-событие после 60с устойчивого пребывания внутри', async () => {
    const center = { lat: 48.48, lon: 135.08 };
    const { deviceToken, childId } = await seedChildAndZone(center);

    // Point 1 — inside, at t0
    const t0 = new Date(Date.now() - 2 * 60 * 1000); // 2min ago so window-check passes
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [{ lat: center.lat, lon: center.lon, recordedAt: t0.toISOString() }] })
      .expect(200);

    const events1 = await h.prisma.zoneEvent.count({ where: { childId } });
    expect(events1).toBe(0);

    // Point 2 — inside, at t0+61s → triggers entry after debounce
    const t1 = new Date(t0.getTime() + 61_000);
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [{ lat: center.lat, lon: center.lon, recordedAt: t1.toISOString() }] })
      .expect(200);

    const events2 = await h.prisma.zoneEvent.findMany({ where: { childId } });
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe('entry');
    expect(events2[0].zoneId).toBeDefined();
  });

  it('exit-событие после entry и 60с вне зоны', async () => {
    const center = { lat: 48.48, lon: 135.08 };
    const { deviceToken, childId } = await seedChildAndZone(center);

    // Prime: two points inside → entry confirmed
    const t0 = new Date(Date.now() - 5 * 60 * 1000);
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [{ lat: center.lat, lon: center.lon, recordedAt: t0.toISOString() }] })
      .expect(200);
    const t1 = new Date(t0.getTime() + 61_000);
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [{ lat: center.lat, lon: center.lon, recordedAt: t1.toISOString() }] })
      .expect(200);

    let events = await h.prisma.zoneEvent.findMany({
      where: { childId },
      orderBy: { recordedAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['entry']);

    // Move outside zone+buffer. Buffer for 250m = max(30, 250*0.15) = 37.5m. So > 287.5m away.
    // Offset ~500m east: rough conversion ~0.0067 degrees at lat 48.48.
    const farLon = center.lon + 0.0067;

    // Point 3 — outside, at t1+5s → starts pending exit (not yet 60s)
    const t2 = new Date(t1.getTime() + 5_000);
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [{ lat: center.lat, lon: farLon, recordedAt: t2.toISOString() }] })
      .expect(200);

    events = await h.prisma.zoneEvent.findMany({ where: { childId } });
    expect(events).toHaveLength(1); // no exit yet

    // Point 4 — outside, at t2+61s → exit confirmed
    const t3 = new Date(t2.getTime() + 61_000);
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [{ lat: center.lat, lon: farLon, recordedAt: t3.toISOString() }] })
      .expect(200);

    events = await h.prisma.zoneEvent.findMany({
      where: { childId },
      orderBy: { recordedAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['entry', 'exit']);
  });
});
