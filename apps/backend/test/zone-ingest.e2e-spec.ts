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

    // Point 3 — outside, at t1+60s → starts pending exit (not yet 60s).
    // ~500 м за 60 с (~8 м/с) — правдоподобно; скачок за 5 с speed-gate
    // пометил бы иглой (outlier), а по иглам геозоны не считаются.
    const t2 = new Date(t1.getTime() + 60_000);
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
    // v0.64.0: у выхода — сколько пробыл в зоне от подтверждённого входа.
    expect(events[1].durationSec).toBe(Math.round((t3.getTime() - t1.getTime()) / 1000));
  });

  // ---- v0.64.0 ----

  async function seedChild(familyId: string, name = 'Аня') {
    const child = await h.prisma.child.create({ data: { familyId, name } });
    const rawToken = randomBytes(32).toString('base64url');
    await h.prisma.childDevice.create({
      data: { childId: child.id, tokenHash: sha256(rawToken), deviceName: 'Test Dev' },
    });
    return { childId: child.id, deviceToken: rawToken };
  }

  async function send(
    deviceToken: string,
    lat: number,
    lon: number,
    at: Date,
    accuracy?: number,
  ): Promise<void> {
    await request(h.app.getHttpServer())
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({
        points: [{ lat, lon, recordedAt: at.toISOString(), ...(accuracy ? { accuracy } : {}) }],
      })
      .expect(200);
  }

  function zoneBody(center: { lat: number; lon: number }, extra: Record<string, unknown>) {
    return {
      name: 'Дом',
      color: '#22c55e',
      icon: 'home',
      centerLat: center.lat,
      centerLon: center.lon,
      radius: 150,
      ...extra,
    };
  }

  it('нет ложного «входа», если ребёнок уже внутри новой зоны', async () => {
    const center = { lat: 48.48, lon: 135.08 };
    const { accessToken, familyId } = await signUpParent(h);
    const { childId, deviceToken } = await seedChild(familyId);
    const t0 = new Date(Date.now() - 6 * 60_000);
    await send(deviceToken, center.lat, center.lon, t0, 10);

    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(zoneBody(center, { childIds: [childId] }))
      .expect(201);
    expect(zone.body.states).toEqual([{ childId, isInside: true }]);

    await send(deviceToken, center.lat, center.lon + 0.0003, new Date(t0.getTime() + 61_000), 10);
    await send(deviceToken, center.lat, center.lon, new Date(t0.getTime() + 125_000), 10);
    expect(await h.prisma.zoneEvent.count({ where: { childId } })).toBe(0);
  });

  it('правка радиуса пересчитывает состояние без события', async () => {
    const center = { lat: 48.48, lon: 135.08 };
    const { accessToken, familyId } = await signUpParent(h);
    const { childId, deviceToken } = await seedChild(familyId);
    // ~300 м к востоку от центра
    const lon300 = center.lon + 0.00405;
    const t0 = new Date(Date.now() - 6 * 60_000);
    await send(deviceToken, center.lat, lon300, t0, 10);

    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(zoneBody(center, { childIds: [childId] }))
      .expect(201);
    expect(zone.body.states).toEqual([{ childId, isInside: false }]);

    const upd = await request(h.app.getHttpServer())
      .patch(`/zones/${zone.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ radius: 500 })
      .expect(200);
    expect(upd.body.states).toEqual([{ childId, isInside: true }]);

    await send(deviceToken, center.lat, lon300 + 0.0003, new Date(t0.getTime() + 61_000), 10);
    await send(deviceToken, center.lat, lon300, new Date(t0.getTime() + 125_000), 10);
    expect(await h.prisma.zoneEvent.count({ where: { childId } })).toBe(0);
  });

  it('грубая точка у границы не сбивает ожидание выхода и не даёт ложный выход', async () => {
    const center = { lat: 48.48, lon: 135.08 };
    const { accessToken, familyId } = await signUpParent(h);
    const { childId, deviceToken } = await seedChild(familyId);
    const t0 = new Date(Date.now() - 6 * 60_000);
    await send(deviceToken, center.lat, center.lon, t0, 10);
    await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(zoneBody(center, { childIds: [childId] }))
      .expect(201);

    // ~200 м от центра с погрешностью 90 м: «неясно» — состояние внутри.
    const lon200 = center.lon + 0.0027;
    await send(deviceToken, center.lat, lon200, new Date(t0.getTime() + 61_000), 90);
    await send(deviceToken, center.lat, lon200, new Date(t0.getTime() + 130_000), 90);
    expect(await h.prisma.zoneEvent.count({ where: { childId } })).toBe(0);
    const st = await h.prisma.zoneState.findFirst({ where: { childId } });
    expect(st?.isInside).toBe(true);
    expect(st?.pendingTransition).toBe(false);
  });

  it('зона «все дети»: новый ребёнок получает состояние молча, выход — событием', async () => {
    const center = { lat: 48.48, lon: 135.08 };
    const { accessToken, familyId } = await signUpParent(h);
    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(zoneBody(center, { allChildren: true }))
      .expect(201);
    expect(zone.body.allChildren).toBe(true);

    const { childId, deviceToken } = await seedChild(familyId, 'Петя');
    const t0 = new Date(Date.now() - 8 * 60_000);
    await send(deviceToken, center.lat, center.lon, t0, 10);
    await send(deviceToken, center.lat, center.lon + 0.0003, new Date(t0.getTime() + 61_000), 10);
    expect(await h.prisma.zoneEvent.count({ where: { childId } })).toBe(0);

    // ~1 км к востоку
    const far = center.lon + 0.0135;
    await send(deviceToken, center.lat, far, new Date(t0.getTime() + 181_000), 10);
    await send(deviceToken, center.lat, far + 0.0003, new Date(t0.getTime() + 245_000), 10);
    const events = await h.prisma.zoneEvent.findMany({ where: { childId } });
    expect(events.map((e) => e.type)).toEqual(['exit']);
    // Вход не наблюдали — длительность неизвестна.
    expect(events[0].durationSec).toBeNull();

    const list = await request(h.app.getHttpServer())
      .get('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body[0].states).toEqual([{ childId, isInside: false }]);
  });
});
