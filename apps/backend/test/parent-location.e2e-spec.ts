import { createHash } from 'node:crypto';
import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';
import { JwtService } from '../src/auth/jwt.service';
import { MAX_PARENT_BATCH_SIZE } from '../src/parent-location/dto/parent-location.dto';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

describe('Parent location (e2e, v0.70.0)', () => {
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

  const server = () => h.app.getHttpServer();
  const pt = (msAgo: number, extra: Record<string, unknown> = {}) => ({
    lat: 48.48,
    lon: 135.08,
    accuracy: 12,
    recordedAt: new Date(Date.now() - msAgo).toISOString(),
    ...extra,
  });

  async function newDevice(accessToken: string, body: Record<string, unknown> = {}) {
    const r = await request(server())
      .post('/parent-location/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)
      .expect(201);
    return r.body as { deviceId: string; token: string };
  }

  function postPoints(token: string, points: unknown[]) {
    return request(server())
      .post('/parent-location/points')
      .set('X-Parent-Location-Token', token)
      .send({ points });
  }

  /** Второй родитель в семье `familyId` (membership + JWT с этой семьёй). */
  async function addSecondParent(familyId: string, email: string, firstName: string | null) {
    const p = await signUpParent(h, email);
    await h.prisma.membership.create({ data: { userId: p.userId, familyId, role: 'parent' } });
    await h.prisma.user.update({ where: { id: p.userId }, data: { firstName, name: null } });
    const accessToken = await h.app.get(JwtService).signAccessToken({
      sub: p.userId,
      email: p.email,
      familyId,
      role: 'parent',
    });
    return { ...p, accessToken };
  }

  it('выдача токена: 401 без JWT, 201 {deviceId, token}, в БД sha256', async () => {
    await request(server()).post('/parent-location/devices').send({}).expect(401);
    const { accessToken, userId } = await signUpParent(h);
    const d = await newDevice(accessToken, { platform: 'android', appVersion: '0.70.0+1' });
    expect(d.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await h.prisma.parentLocationDevice.findUniqueOrThrow({
      where: { id: d.deviceId },
    });
    expect(row).toMatchObject({
      userId,
      tokenHash: sha256(d.token),
      platform: 'android',
      appVersion: '0.70.0+1',
      revokedAt: null,
    });
    await request(server())
      .post('/parent-location/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ extra: 1 })
      .expect(400);
  });

  it('приём точек: accepted, дедуп, фильтры, lastSeenAt, 413/400/401', async () => {
    const { accessToken, userId } = await signUpParent(h);
    const d = await newDevice(accessToken);

    const first = [pt(60_000), pt(30_000, { isMock: true, speed: 1.2, batteryLevel: 80 })];
    const r1 = await postPoints(d.token, first).expect(200);
    expect(r1.body).toEqual({ accepted: 2, rejected: 0, sharingDisabled: false });

    const r2 = await postPoints(d.token, [
      ...first,
      pt(10_000, { accuracy: 600 }),
      pt(8 * 24 * 3600 * 1000),
    ]).expect(200);
    expect(r2.body).toEqual({ accepted: 0, rejected: 4, sharingDisabled: false });

    expect(await h.prisma.parentLocation.count({ where: { userId } })).toBe(2);
    const dev = await h.prisma.parentLocationDevice.findUniqueOrThrow({
      where: { id: d.deviceId },
    });
    expect(dev.lastSeenAt).not.toBeNull();

    const big = Array.from({ length: MAX_PARENT_BATCH_SIZE + 1 }, (_, i) => pt(i * 1000));
    const r413 = await postPoints(d.token, big).expect(413);
    expect(r413.body.error.code).toBe('batch_too_large');

    await postPoints(d.token, [{ ...pt(1000), wifiSsid: 'x' }]).expect(400);
    await request(server())
      .post('/parent-location/points')
      .send({ points: [pt(1)] })
      .expect(401);
    await postPoints('nope', [pt(1000)]).expect(401);
  });

  it('401 на отозванный токен: replaceDeviceId, DELETE, удалённый пользователь', async () => {
    const mom = await signUpParent(h);
    const other = await signUpParent(h);
    const d1 = await newDevice(mom.accessToken);
    const d2 = await newDevice(mom.accessToken, { replaceDeviceId: d1.deviceId });
    await postPoints(d1.token, [pt(1000)]).expect(401);
    await postPoints(d2.token, [pt(1000)]).expect(200);

    // Чужое устройство не удалить
    await request(server())
      .delete(`/parent-location/devices/${d2.deviceId}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    await request(server())
      .delete(`/parent-location/devices/${d2.deviceId}`)
      .set('Authorization', `Bearer ${mom.accessToken}`)
      .expect(204);
    await postPoints(d2.token, [pt(2000)]).expect(401);

    const d3 = await newDevice(mom.accessToken);
    await h.prisma.user.update({ where: { id: mom.userId }, data: { deletedAt: new Date() } });
    await postPoints(d3.token, [pt(1000)]).expect(401);
  });

  it('флаг: GET/PUT, выключение удаляет точки, затем sharingDisabled', async () => {
    const { accessToken, userId } = await signUpParent(h);
    const d = await newDevice(accessToken);
    await postPoints(d.token, [pt(60_000), pt(30_000)]).expect(200);

    const auth = { Authorization: `Bearer ${accessToken}` };
    const g1 = await request(server()).get('/parent-location/sharing').set(auth).expect(200);
    expect(g1.body).toEqual({ enabled: true });

    await request(server())
      .put('/parent-location/sharing')
      .set(auth)
      .send({ enabled: 'no' })
      .expect(400);
    const off = await request(server())
      .put('/parent-location/sharing')
      .set(auth)
      .send({ enabled: false })
      .expect(200);
    expect(off.body).toEqual({ enabled: false });
    expect(await h.prisma.parentLocation.count({ where: { userId } })).toBe(0);

    const r = await postPoints(d.token, [pt(5000)]).expect(200);
    expect(r.body).toEqual({ accepted: 0, rejected: 1, sharingDisabled: true });
    expect(await h.prisma.parentLocation.count({ where: { userId } })).toBe(0);

    const g2 = await request(server()).get('/parent-location/sharing').set(auth).expect(200);
    expect(g2.body).toEqual({ enabled: false });

    await request(server())
      .put('/parent-location/sharing')
      .set(auth)
      .send({ enabled: true })
      .expect(200);
    const r2 = await postPoints(d.token, [pt(5000)]).expect(200);
    expect(r2.body).toEqual({ accepted: 1, rejected: 0, sharingDisabled: false });
  });

  it('latest: parents с isMe и именем, без выключивших, без mock, без чужой семьи', async () => {
    const mom = await signUpParent(h, 'olga.mama@seed.test');
    await h.prisma.user.update({ where: { id: mom.userId }, data: { name: 'Мама' } });
    const dad = await addSecondParent(mom.familyId, 'papa@seed.test', null);
    const stranger = await signUpParent(h);

    const momDev = await newDevice(mom.accessToken);
    const dadDev = await newDevice(dad.accessToken);
    const strangerDev = await newDevice(stranger.accessToken);
    await postPoints(momDev.token, [
      pt(120_000, { lat: 48.1 }),
      // Свежая, но подделанная — на карту не идёт, остаётся 48.1
      pt(10_000, { lat: 10, isMock: true }),
    ]).expect(200);
    await postPoints(dadDev.token, [pt(60_000, { lat: 48.2, accuracy: 30 })]).expect(200);
    await postPoints(strangerDev.token, [pt(60_000, { lat: 1 })]).expect(200);

    const res = await request(server())
      .get('/family/locations/latest')
      .set('Authorization', `Bearer ${mom.accessToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.parents).toHaveLength(2);
    const me = res.body.parents.find((p: { userId: string }) => p.userId === mom.userId);
    const papa = res.body.parents.find((p: { userId: string }) => p.userId === dad.userId);
    expect(me).toMatchObject({ name: 'Мама', lat: 48.1, lon: 135.08, accuracy: 12, isMe: true });
    expect(me.ageSec).toBeGreaterThanOrEqual(119);
    expect(Object.keys(me).sort()).toEqual(
      ['accuracy', 'ageSec', 'isMe', 'lat', 'lon', 'name', 'recordedAt', 'userId'].sort(),
    );
    expect(papa).toMatchObject({ name: 'papa', lat: 48.2, accuracy: 30, isMe: false });

    // Отец выключил «Показывать меня семье» → пропадает с карты
    await request(server())
      .put('/parent-location/sharing')
      .set('Authorization', `Bearer ${dad.accessToken}`)
      .send({ enabled: false })
      .expect(200);
    const res2 = await request(server())
      .get('/family/locations/latest')
      .set('Authorization', `Bearer ${dad.accessToken}`)
      .expect(200);
    expect(res2.body.parents).toHaveLength(1);
    expect(res2.body.parents[0]).toMatchObject({ userId: mom.userId, isMe: false });
  });

  it('PUT /family/locations/watch: 204, отметка на всех неудалённых детей', async () => {
    await request(server()).put('/family/locations/watch').expect(401);
    const { accessToken, userId, familyId } = await signUpParent(h);
    const anya = await h.prisma.child.create({ data: { familyId, name: 'Аня' } });
    const petya = await h.prisma.child.create({ data: { familyId, name: 'Петя' } });
    const gone = await h.prisma.child.create({
      data: { familyId, name: 'Удалён', deletedAt: new Date() },
    });

    await request(server())
      .put('/family/locations/watch')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    expect(await h.redis.zrange(`loc-watch:${anya.id}`, 0, -1)).toEqual([userId]);
    expect(await h.redis.zrange(`loc-watch:${petya.id}`, 0, -1)).toEqual([userId]);
    expect(await h.redis.exists(`loc-watch:${gone.id}`)).toBe(0);
  });
});
