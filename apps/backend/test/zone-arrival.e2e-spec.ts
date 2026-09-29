import request from 'supertest';
import { randomBytes, createHash } from 'node:crypto';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';
import { ZoneArrivalService } from '../src/zones/zone-arrival.service';

// v0.65.0: «не пришёл к сроку». Срок 08:30 + запас 10 мин по Владивостоку;
// «сейчас» — среда 08:45 местного (вторник 22:45 UTC).
const NOW = new Date('2026-09-29T22:45:00Z');
const TZ = 'Asia/Vladivostok';
const CENTER = { lat: 48.48, lon: 135.08 };
const FAR_LON = CENTER.lon + 0.0135; // ~1 км к востоку

describe('Zone arrival deadline (e2e)', () => {
  let h: TestAppHandle;
  let arrival: ZoneArrivalService;

  beforeAll(async () => {
    h = await bootTestApp();
    arrival = h.app.get(ZoneArrivalService);
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
  });

  async function seed(point?: { lon: number; ageMin: number }) {
    const { accessToken, familyId } = await signUpParent(h);
    const child = await h.prisma.child.create({ data: { familyId, name: 'Аня' } });
    const device = await h.prisma.childDevice.create({
      data: {
        childId: child.id,
        tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
        deviceName: 'Test',
      },
    });
    if (point) {
      await h.prisma.location.create({
        data: {
          childId: child.id,
          childDeviceId: device.id,
          lat: CENTER.lat,
          lon: point.lon,
          accuracy: 10,
          recordedAt: new Date(NOW.getTime() - point.ageMin * 60_000),
        },
      });
    }
    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Школа',
        color: '#3b82f6',
        icon: 'school',
        centerLat: CENTER.lat,
        centerLon: CENTER.lon,
        radius: 150,
        allChildren: true,
        timezone: TZ,
        arrival: { deadlineMin: 510, daysMask: 127, graceMin: 10 },
      })
      .expect(201);
    return {
      accessToken,
      familyId,
      childId: child.id,
      zoneId: zone.body.id as string,
      zone: zone.body,
    };
  }

  it('вне зоны со свежей точкой — одно событие missed_arrival, повторный тик не дублирует', async () => {
    const { childId, zoneId, zone } = await seed({ lon: FAR_LON, ageMin: 5 });
    expect(zone.arrival).toEqual({ deadlineMin: 510, daysMask: 127, graceMin: 10 });
    expect(zone.timezone).toBe(TZ);

    const first = await arrival.tick(NOW);
    expect(first.map((n) => n.eventType)).toEqual(['missed_arrival']);
    await arrival.tick(new Date(NOW.getTime() + 60_000));

    const events = await h.prisma.zoneEvent.findMany({ where: { zoneId, childId } });
    expect(events.map((e) => e.type)).toEqual(['missed_arrival']);
    const check = await h.prisma.zoneArrivalCheck.findFirst({ where: { zoneId, childId } });
    expect(check).toMatchObject({ localDate: '2026-09-30', verdict: 'missed' });
  });

  it('ребёнок в зоне — пришёл, событий нет', async () => {
    const { childId, zoneId } = await seed({ lon: CENTER.lon, ageMin: 5 });
    expect(await arrival.tick(NOW)).toEqual([]);
    expect(await h.prisma.zoneEvent.count({ where: { zoneId } })).toBe(0);
    const check = await h.prisma.zoneArrivalCheck.findFirst({ where: { zoneId, childId } });
    expect(check?.verdict).toBe('arrived');
  });

  it('вошёл утром до срока и ушёл — считается пришедшим', async () => {
    const { childId, zoneId } = await seed({ lon: FAR_LON, ageMin: 5 });
    await h.prisma.zoneEvent.create({
      data: {
        zoneId,
        childId,
        type: 'entry',
        lat: CENTER.lat,
        lon: CENTER.lon,
        recordedAt: new Date(NOW.getTime() - 40 * 60_000), // 08:05 местного
      },
    });
    expect(await arrival.tick(NOW)).toEqual([]);
    const check = await h.prisma.zoneArrivalCheck.findFirst({ where: { zoneId, childId } });
    expect(check?.verdict).toBe('arrived');
  });

  it('телефон молчит — no_data, а не «не пришёл»', async () => {
    const { zoneId } = await seed({ lon: FAR_LON, ageMin: 120 });
    const notices = await arrival.tick(NOW);
    expect(notices.map((n) => n.eventType)).toEqual(['no_data']);
    const ev = await h.prisma.zoneEvent.findFirst({ where: { zoneId } });
    expect(ev?.type).toBe('no_data');
  });

  it('до срока + запаса проверки нет', async () => {
    const { zoneId } = await seed({ lon: FAR_LON, ageMin: 5 });
    expect(await arrival.tick(new Date(NOW.getTime() - 10 * 60_000))).toEqual([]); // 08:35
    expect(await h.prisma.zoneArrivalCheck.count({ where: { zoneId } })).toBe(0);
  });

  it('день не из маски — проверки нет', async () => {
    const { accessToken, zoneId } = await seed({ lon: FAR_LON, ageMin: 5 });
    await request(h.app.getHttpServer())
      .patch(`/zones/${zoneId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ arrival: { deadlineMin: 510, daysMask: 1, graceMin: 10 } }) // только ПН, а сейчас СР
      .expect(200);
    expect(await arrival.tick(NOW)).toEqual([]);
  });

  it('лента отдаёт новые типы', async () => {
    const { accessToken } = await seed({ lon: FAR_LON, ageMin: 5 });
    await arrival.tick(NOW);
    const res = await request(h.app.getHttpServer())
      .get('/zones/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.items.map((e: { type: string }) => e.type)).toEqual(['missed_arrival']);
  });

  it('личные настройки: PUT и чтение в GET /zones; чужой ребёнок — 404', async () => {
    const { accessToken, childId, zoneId } = await seed();
    const put = await request(h.app.getHttpServer())
      .put(`/zones/${zoneId}/my-notifications`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ items: [{ childId, onEntry: false, onExit: true, onMissedArrival: false }] })
      .expect(200);
    expect(put.body.items).toEqual([
      { childId, onEntry: false, onExit: true, onMissedArrival: false },
    ]);
    const list = await request(h.app.getHttpServer())
      .get('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body[0].myPrefs).toEqual(put.body.items);

    const other = await signUpParent(h, 'other-parent@seed.test');
    const foreign = await h.prisma.child.create({
      data: { familyId: other.familyId, name: 'Чужой' },
    });
    await request(h.app.getHttpServer())
      .put(`/zones/${zoneId}/my-notifications`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ childId: foreign.id, onEntry: true, onExit: true, onMissedArrival: true }],
      })
      .expect(404);
  });

  it('расписание и срок без пояса — 400 timezone_required; null снимает', async () => {
    const { accessToken, zoneId } = await seed();
    const bad = await request(h.app.getHttpServer())
      .patch(`/zones/${zoneId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ timezone: null })
      .expect(400);
    expect(bad.body.error.code).toBe('timezone_required');

    const off = await request(h.app.getHttpServer())
      .patch(`/zones/${zoneId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ arrival: null, schedule: { daysMask: 31, startMin: 1260, endMin: 420 } })
      .expect(200);
    expect(off.body.arrival).toBeNull();
    expect(off.body.schedule).toEqual({ daysMask: 31, startMin: 1260, endMin: 420 });
  });
});
