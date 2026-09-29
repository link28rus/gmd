import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';

describe('POST/GET/PATCH/DELETE /zones (e2e)', () => {
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

  const validBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Школа',
    color: '#22c55e',
    icon: 'school',
    centerLat: 48.48,
    centerLon: 135.08,
    radius: 250,
    childIds: [] as string[],
    ...overrides,
  });

  it('401 без JWT', async () => {
    await request(h.app.getHttpServer()).post('/zones').send(validBody()).expect(401);
  });

  it('создаёт зону 201 и возвращает её в GET /zones', async () => {
    const { accessToken } = await signUpParent(h);
    const create = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(201);
    expect(create.body.id).toBeDefined();
    expect(create.body.name).toBe('Школа');

    const list = await request(h.app.getHttpServer())
      .get('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(create.body.id);
  });

  it('409 zone_limit_reached при 21-й зоне', async () => {
    const { accessToken } = await signUpParent(h);
    // POST /zones имеет throttle 10/min → flush Redis каждые 8 запросов,
    // чтобы не упереться в rate-limit во время наполнения.
    for (let i = 0; i < 20; i++) {
      if (i % 8 === 0) await h.redis.flushdb();
      await request(h.app.getHttpServer())
        .post('/zones')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validBody({ name: `Z${i}` }))
        .expect(201);
    }
    await h.redis.flushdb();
    const res = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ name: 'Overflow' }))
      .expect(409);
    expect(res.body.error.code).toBe('zone_limit_reached');
  });

  it('400 при невалидном color', async () => {
    const { accessToken } = await signUpParent(h);
    await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ color: '#fffffe' }))
      .expect(400);
  });

  it('400 при radius < 50', async () => {
    const { accessToken } = await signUpParent(h);
    await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ radius: 10 }))
      .expect(400);
  });

  it('v0.64.0: 400 при radius < 100, 201 при 100', async () => {
    const { accessToken } = await signUpParent(h);
    await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ radius: 99 }))
      .expect(400);
    await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ radius: 100 }))
      .expect(201);
  });

  it('v0.64.0: дубли childIds не дают 500 — уникализируются', async () => {
    const { accessToken, familyId } = await signUpParent(h);
    const child = await h.prisma.child.create({ data: { familyId, name: 'Аня' } });
    const res = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ childIds: [child.id, child.id] }))
      .expect(201);
    expect(res.body.childIds).toEqual([child.id]);
    expect(res.body.allChildren).toBe(false);
  });

  it('v0.64.0: курсор ленты не теряет события с одинаковым recordedAt', async () => {
    const { accessToken, familyId } = await signUpParent(h);
    const child = await h.prisma.child.create({ data: { familyId, name: 'Аня' } });
    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody({ childIds: [child.id] }))
      .expect(201);
    const at = new Date('2026-09-29T10:00:00Z');
    for (let i = 0; i < 3; i++) {
      await h.prisma.zoneEvent.create({
        data: {
          zoneId: zone.body.id,
          childId: child.id,
          type: i % 2 === 0 ? 'entry' : 'exit',
          lat: 48.48,
          lon: 135.08,
          recordedAt: at,
          durationSec: i % 2 === 0 ? null : 600,
        },
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res = await request(h.app.getHttpServer())
        .get('/zones/events')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      seen.push(...res.body.items.map((e: { id: string }) => e.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(3);

    const filtered = await request(h.app.getHttpServer())
      .get('/zones/events')
      .query({ zoneId: zone.body.id, childId: child.id })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(filtered.body.items).toHaveLength(3);
    const exit = filtered.body.items.find((e: { type: string }) => e.type === 'exit');
    expect(exit.durationSec).toBe(600);

    await request(h.app.getHttpServer())
      .get('/zones/events')
      .query({ cursor: 'мусор' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('v0.64.0: /family/locations/latest — последняя хорошая точка каждого ребёнка', async () => {
    const { accessToken, familyId } = await signUpParent(h);
    const anya = await h.prisma.child.create({ data: { familyId, name: 'Аня' } });
    const petya = await h.prisma.child.create({ data: { familyId, name: 'Петя' } });
    const dev = await h.prisma.childDevice.create({
      data: { childId: anya.id, tokenHash: 'e2e-hash-anya', deviceName: 'T' },
    });
    const now = Date.now();
    await h.prisma.location.createMany({
      data: [
        {
          childId: anya.id,
          childDeviceId: dev.id,
          lat: 48.1,
          lon: 135.1,
          accuracy: 10,
          recordedAt: new Date(now - 120_000),
        },
        {
          childId: anya.id,
          childDeviceId: dev.id,
          lat: 55.7,
          lon: 37.6,
          accuracy: 10,
          recordedAt: new Date(now - 60_000),
          trackFlag: 'outlier',
        },
      ],
    });
    const res = await request(h.app.getHttpServer())
      .get('/family/locations/latest')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ childId: anya.id, lat: 48.1, lon: 135.1 });
    expect(res.body.items.find((i: { childId: string }) => i.childId === petya.id)).toBeUndefined();
  });

  it('v0.64.0: /geo/ip-center — 401 без JWT, 204 для локального адреса', async () => {
    await request(h.app.getHttpServer()).get('/geo/ip-center').expect(401);
    const { accessToken } = await signUpParent(h);
    await request(h.app.getHttpServer())
      .get('/geo/ip-center')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('404 при GET чужой зоны (anti-enumeration)', async () => {
    const p1 = await signUpParent(h);
    const p2 = await signUpParent(h, 'other-parent@seed.test');
    const create = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${p1.accessToken}`)
      .send(validBody())
      .expect(201);
    const res = await request(h.app.getHttpServer())
      .get(`/zones/${create.body.id}`)
      .set('Authorization', `Bearer ${p2.accessToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('zone_not_found');
  });

  it('PATCH обновляет name', async () => {
    const { accessToken } = await signUpParent(h);
    const create = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(201);
    const upd = await request(h.app.getHttpServer())
      .patch(`/zones/${create.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Новое имя' })
      .expect(200);
    expect(upd.body.name).toBe('Новое имя');
  });

  it('DELETE возвращает 204 и зона исчезает из списка', async () => {
    const { accessToken } = await signUpParent(h);
    const create = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody())
      .expect(201);
    await request(h.app.getHttpServer())
      .delete(`/zones/${create.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    const list = await request(h.app.getHttpServer())
      .get('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('GET /zones/events возвращает empty список при отсутствии событий', async () => {
    const { accessToken } = await signUpParent(h);
    const res = await request(h.app.getHttpServer())
      .get('/zones/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });
});
