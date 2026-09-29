import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';

// v0.67.0 (геозоны v2, этап 4): подсказки мест и статистика визитов.

const TZ = 'Asia/Vladivostok'; // UTC+10
const HOUR = 3_600_000;
const LAT0 = 48.48;
const LON0 = 135.08;
const M_PER_DEG = 111_195;
const HOME = { lat: LAT0, lon: LON0 };
const SCHOOL = { lat: LAT0 + 2000 / M_PER_DEG, lon: LON0 + 0.01 };
const FAR = { lat: LAT0 - 3000 / M_PER_DEG, lon: LON0 };

// Местная полночь (UTC+10) `daysAgo` дней назад.
function localMidnight(daysAgo: number): number {
  const nowLocal = Date.now() + 10 * HOUR;
  return Math.floor(nowLocal / (24 * HOUR)) * 24 * HOUR - 10 * HOUR - daysAgo * 24 * HOUR;
}

interface P {
  lat: number;
  lon: number;
  t: number;
}

function sit(place: { lat: number; lon: number }, from: number, to: number, stepMin: number): P[] {
  const out: P[] = [];
  for (let t = from, i = 0; t <= to; t += stepMin * 60_000, i++) {
    out.push({ lat: place.lat + (i % 2 ? 0.0001 : -0.0001), lon: place.lon, t });
  }
  return out;
}

/** Будни: ночь дома, школа 08:00–13:00 (если school), вечер дома. */
function days(daysAgo: number[], school: boolean): P[] {
  return daysAgo.flatMap((d) => {
    const m = localMidnight(d);
    return [
      ...sit(HOME, m, m + 7 * HOUR, 60),
      ...(school ? sit(SCHOOL, m + 8 * HOUR, m + 13 * HOUR, 15) : []),
      ...sit(HOME, m + 14 * HOUR, m + 24 * HOUR - 60_000, 60),
    ];
  });
}

describe('GET /zones/suggestions, /zones/:id/stats (e2e)', () => {
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

  async function seed() {
    const { accessToken, familyId } = await signUpParent(h);
    const anya = await h.prisma.child.create({ data: { familyId, name: 'Аня' } });
    const petya = await h.prisma.child.create({ data: { familyId, name: 'Петя' } });
    for (const [child, school] of [
      [anya, true],
      [petya, false],
    ] as const) {
      const dev = await h.prisma.childDevice.create({
        data: { childId: child.id, tokenHash: `e2e-hash-${child.id}`, deviceName: 'T' },
      });
      // Пять последних дней, без сегодняшнего (у него нет полной ночи).
      await h.prisma.location.createMany({
        data: days([1, 2, 3, 4, 5], school).map((p) => ({
          childId: child.id,
          childDeviceId: dev.id,
          lat: p.lat,
          lon: p.lon,
          accuracy: 20,
          recordedAt: new Date(p.t),
        })),
      });
    }
    // Вася бывает дома только днём (ночных точек нет) — у него это «частое
    // место», и отдельной подсказкой рядом с «Дом?» оно не показывается.
    const vasya = await h.prisma.child.create({ data: { familyId, name: 'Вася' } });
    const vDev = await h.prisma.childDevice.create({
      data: { childId: vasya.id, tokenHash: `e2e-hash-${vasya.id}`, deviceName: 'T' },
    });
    await h.prisma.location.createMany({
      data: [1, 2, 3, 4]
        .flatMap((d) => [
          ...sit(HOME, localMidnight(d) + 15 * HOUR, localMidnight(d) + 19 * HOUR, 20),
          // Две точки вечером в 3 км (10 минут — не стоянка): дом не тянется через ночь.
          ...sit(FAR, localMidnight(d) + 21 * HOUR, localMidnight(d) + 21 * HOUR + 600_000, 10),
        ])
        .map((p) => ({
          childId: vasya.id,
          childDeviceId: vDev.id,
          lat: p.lat,
          lon: p.lon,
          accuracy: 20,
          recordedAt: new Date(p.t),
        })),
    });
    return { accessToken, familyId, anya, petya, vasya };
  }

  const get = (path: string, token: string) =>
    request(h.app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  it('401 без JWT, 400 при неизвестном поясе', async () => {
    await request(h.app.getHttpServer()).get('/zones/suggestions').expect(401);
    const { accessToken } = await signUpParent(h);
    const res = await get('/zones/suggestions?tz=Mars/Base', accessToken).expect(400);
    expect(res.body.error.code).toBe('invalid_timezone');
  });

  it('дом общий на двоих детей, школа — у одного; скрытие и зона гасят подсказку', async () => {
    const { accessToken, anya, petya, vasya } = await seed();
    const res = await get(`/zones/suggestions?tz=${TZ}`, accessToken).expect(200);
    const kinds = res.body.map((s: { kind: string }) => s.kind);
    // Среди пяти дней подряд всегда не меньше трёх будних — школа найдётся.
    expect(kinds).toEqual(['home', 'school']);
    const home = res.body[0];
    expect(home).toMatchObject({ name: 'Дом', icon: 'home', color: '#22c55e' });
    expect(new Set(home.childIds)).toEqual(new Set([anya.id, petya.id, vasya.id]));
    // Доказательства — только у тех, у кого место распознано домом.
    expect(home.children.map((c: { childId: string }) => c.childId).sort()).toEqual(
      [anya.id, petya.id].sort(),
    );
    expect(home.children[0].days).toBeLessThanOrEqual(home.children[0].daysWithData);
    expect(Math.abs(home.centerLat - HOME.lat) * M_PER_DEG).toBeLessThan(50);
    expect(home.children[0].days).toBeGreaterThanOrEqual(3);

    const school = res.body[1];
    expect(school).toMatchObject({ name: 'Школа', icon: 'school', childIds: [anya.id] });
    expect(school.children[0].typicalFromMin).toBe(8 * 60);

    // «Больше не показывать» у дома.
    await request(h.app.getHttpServer())
      .post('/zones/suggestions/dismiss')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'home', centerLat: home.centerLat, centerLon: home.centerLon })
      .expect(204);

    // Повторное скрытие того же места новой строки не даёт.
    await request(h.app.getHttpServer())
      .post('/zones/suggestions/dismiss')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind: 'home', centerLat: home.centerLat + 0.0005, centerLon: home.centerLon })
      .expect(204);
    expect(await h.prisma.zonePlaceDismissal.count()).toBe(1);

    // Зона на месте школы.
    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Школа',
        color: '#3b82f6',
        icon: 'school',
        centerLat: school.centerLat,
        centerLon: school.centerLon,
        radius: school.radius,
        childIds: [anya.id],
      })
      .expect(201);

    const after = await get(`/zones/suggestions?tz=${TZ}`, accessToken).expect(200);
    expect(after.body).toEqual([]);

    // Статистика школы: пять визитов Ани по 5 часов, приход 08:00, уход 13:00.
    const stats = await get(`/zones/${zone.body.id}/stats?tz=${TZ}`, accessToken).expect(200);
    expect(stats.body).toMatchObject({ zoneId: zone.body.id, periodDays: 30, timezone: TZ });
    expect(stats.body.children).toHaveLength(1);
    expect(stats.body.children[0]).toMatchObject({
      childId: anya.id,
      visits: 5,
      daysCount: 5,
      avgSec: 5 * 3600,
      ongoing: false,
      typicalArrivalMin: 8 * 60,
      typicalDepartureMin: 13 * 60,
    });
  });

  it('статистика чужой зоны — 404, пояс зоны главнее параметра', async () => {
    const { accessToken, anya } = await seed();
    const zone = await request(h.app.getHttpServer())
      .post('/zones')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Дом',
        color: '#22c55e',
        icon: 'home',
        centerLat: HOME.lat,
        centerLon: HOME.lon,
        radius: 150,
        childIds: [anya.id],
        timezone: TZ,
        arrival: { deadlineMin: 18 * 60, daysMask: 31 },
      })
      .expect(201);
    const stats = await get(`/zones/${zone.body.id}/stats?tz=Europe/Moscow`, accessToken).expect(
      200,
    );
    expect(stats.body.timezone).toBe(TZ);

    const other = await signUpParent(h, 'other@example.com');
    await get(`/zones/${zone.body.id}/stats`, other.accessToken).expect(404);
  });
});
