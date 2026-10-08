import { createHash } from 'node:crypto';
import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';
import { JwtService } from '../src/auth/jwt.service';
import { MAX_PARENT_BATCH_SIZE } from '../src/parent-location/dto/parent-location.dto';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

describe('Parent location (e2e, v0.70.0 + v0.73.0 find phone)', () => {
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
      pt(31 * 24 * 3600 * 1000),
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

  it('v0.73.1: офлайн-буфер — точки до 30 дней давности принимаются', async () => {
    const { accessToken, userId } = await signUpParent(h);
    const d = await newDevice(accessToken);
    const r = await postPoints(d.token, [
      pt(29 * 24 * 3600 * 1000),
      pt(8 * 24 * 3600 * 1000),
      pt(31 * 24 * 3600 * 1000),
    ]).expect(200);
    expect(r.body).toEqual({ accepted: 2, rejected: 1, sharingDisabled: false });
    expect(await h.prisma.parentLocation.count({ where: { userId } })).toBe(2);
  });

  it('флаг: GET/PUT; v0.73.0 — выключение не удаляет точки, приём продолжается', async () => {
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
    expect(await h.prisma.parentLocation.count({ where: { userId } })).toBe(2);

    const r = await postPoints(d.token, [pt(5000)]).expect(200);
    expect(r.body).toEqual({ accepted: 1, rejected: 0, sharingDisabled: false });
    expect(await h.prisma.parentLocation.count({ where: { userId } })).toBe(3);

    const g2 = await request(server()).get('/parent-location/sharing').set(auth).expect(200);
    expect(g2.body).toEqual({ enabled: false });
  });

  it('«Найти телефон»: список, маршрут, сигнал и подтверждение; участник — только свои', async () => {
    const mom = await signUpParent(h);
    const dad = await addSecondParent(mom.familyId, 'papa2@seed.test', 'Папа');
    const momAuth = { Authorization: `Bearer ${mom.accessToken}` };
    const dadAuth = { Authorization: `Bearer ${dad.accessToken}` };

    await request(server()).get('/parent-location/my-devices').expect(401);
    const empty = await request(server()).get('/parent-location/my-devices').set(momAuth);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [] });

    const d = await newDevice(mom.accessToken, { platform: 'android', appVersion: '0.73.0+1' });
    const dadDev = await newDevice(dad.accessToken);
    // Выключенный флаг семьи не мешает «Найти телефон»
    await request(server())
      .put('/parent-location/sharing')
      .set(momAuth)
      .send({ enabled: false })
      .expect(200);
    await request(server())
      .post('/parent-location/points')
      .set('X-Parent-Location-Token', d.token)
      .send({
        points: [
          pt(2 * 3600_000, { lat: 48.1, batteryLevel: 80 }),
          pt(3600_000, { lat: 48.2, batteryLevel: 55, isCharging: true }),
          pt(60_000, { lat: 1, isMock: true }),
        ],
        device: { name: 'Xiaomi 2201', pushToken: 'fcm-token-1' },
      })
      .expect(200);
    await postPoints(dadDev.token, [pt(1000, { lat: 50 })]).expect(200);

    const list = await request(server()).get('/parent-location/my-devices').set(momAuth);
    expect(list.status).toBe(200);
    // Мама — владелец: свой телефон первым, телефон папы следом
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([d.deviceId, dadDev.deviceId]);
    expect(list.body.items[0]).toMatchObject({
      id: d.deviceId,
      deviceName: 'Xiaomi 2201',
      customName: null,
      isMine: true,
      appVersion: '0.73.0+1',
      canPush: true,
      signal: null,
      latest: { lat: 48.2, batteryLevel: 55, isCharging: true },
    });

    // Маршрут: окно не больше 2 суток, чужое устройство — 404
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const track = await request(server())
      .get(`/parent-location/my-devices/${d.deviceId}/track`)
      .query({ from, to })
      .set(momAuth)
      .expect(200);
    expect(track.body.items.map((p: { lat: number }) => p.lat)).toEqual([48.1, 48.2]);
    await request(server())
      .get(`/parent-location/my-devices/${d.deviceId}/track`)
      .query({ from: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(), to })
      .set(momAuth)
      .expect(400);
    await request(server())
      .get(`/parent-location/my-devices/${d.deviceId}/track`)
      .query({ from, to })
      .set(dadAuth)
      .expect(404);

    // Сигнал: чужой — 404; свой — живой, повтор возвращает тот же id
    await request(server())
      .post(`/parent-location/my-devices/${d.deviceId}/signal`)
      .set(dadAuth)
      .expect(404);
    const s1 = await request(server())
      .post(`/parent-location/my-devices/${d.deviceId}/signal`)
      .set(momAuth)
      .expect(200);
    expect(s1.body).toMatchObject({ signalId: expect.any(String), pushed: false });
    const s2 = await request(server())
      .post(`/parent-location/my-devices/${d.deviceId}/signal`)
      .set(momAuth)
      .expect(200);
    expect(s2.body.signalId).toBe(s1.body.signalId);

    // Запасной путь: сигнал в ответе на выгрузку точек
    const up = await postPoints(d.token, [pt(500)]).expect(200);
    expect(up.body.signal).toEqual({ id: s1.body.signalId });

    const pending = await request(server()).get('/parent-location/my-devices').set(momAuth);
    expect(pending.body.items[0].signal).toMatchObject({
      id: s1.body.signalId,
      status: 'pending',
      ackedAt: null,
    });

    // Подтверждение чужим токеном ничего не меняет
    await request(server())
      .post('/parent-location/signal/ack')
      .set('X-Parent-Location-Token', dadDev.token)
      .send({ signalId: s1.body.signalId })
      .expect(200);
    await request(server())
      .post('/parent-location/signal/ack')
      .set('X-Parent-Location-Token', d.token)
      .send({ signalId: s1.body.signalId })
      .expect(200);
    const ringing = await request(server()).get('/parent-location/my-devices').set(momAuth);
    expect(ringing.body.items[0].signal).toMatchObject({ status: 'ringing' });
    const after = await postPoints(d.token, [pt(400)]).expect(200);
    expect(after.body.signal).toBeUndefined();

    // Новый сигнал после подтверждения — новый id
    const s3 = await request(server())
      .post(`/parent-location/my-devices/${d.deviceId}/signal`)
      .set(momAuth)
      .expect(200);
    expect(s3.body.signalId).not.toBe(s1.body.signalId);
  });

  it('v0.74.0: владелец видит телефоны взрослых семьи, зовёт и переименовывает', async () => {
    const mom = await signUpParent(h);
    const dad = await addSecondParent(mom.familyId, 'papa3@seed.test', 'Папа');
    const stranger = await signUpParent(h, 'stranger@seed.test');
    const momAuth = { Authorization: `Bearer ${mom.accessToken}` };
    const dadAuth = { Authorization: `Bearer ${dad.accessToken}` };
    const strangerAuth = { Authorization: `Bearer ${stranger.accessToken}` };

    const momDev = await newDevice(mom.accessToken);
    const dadDev = await newDevice(dad.accessToken, { platform: 'android' });
    const strangerDev = await newDevice(stranger.accessToken);
    // Папа скрылся с карты семьи — для владельца в «Найти телефон» это не важно
    await request(server())
      .put('/parent-location/sharing')
      .set(dadAuth)
      .send({ enabled: false })
      .expect(200);
    await request(server())
      .post('/parent-location/points')
      .set('X-Parent-Location-Token', dadDev.token)
      .send({
        points: [pt(3600_000, { lat: 49.1, batteryLevel: 40 })],
        device: { name: 'Redmi Note', pushToken: 'fcm-dad' },
      })
      .expect(200);
    await postPoints(strangerDev.token, [pt(1000)]).expect(200);

    const momList = await request(server()).get('/parent-location/my-devices').set(momAuth);
    expect(momList.body.items.map((i: { id: string }) => i.id)).toEqual([
      momDev.deviceId,
      dadDev.deviceId,
    ]);
    expect(momList.body.items[1]).toMatchObject({
      isMine: false,
      ownerName: 'Папа',
      deviceName: 'Redmi Note',
      canPush: true,
      latest: { lat: 49.1, batteryLevel: 40 },
    });
    const dadList = await request(server()).get('/parent-location/my-devices').set(dadAuth);
    expect(dadList.body.items.map((i: { id: string }) => i.id)).toEqual([dadDev.deviceId]);

    // Маршрут и сигнал на телефон папы — владельцу можно, чужому владельцу — 404
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const track = await request(server())
      .get(`/parent-location/my-devices/${dadDev.deviceId}/track`)
      .query({ from, to })
      .set(momAuth)
      .expect(200);
    expect(track.body.items.map((p: { lat: number }) => p.lat)).toEqual([49.1]);
    await request(server())
      .get(`/parent-location/my-devices/${dadDev.deviceId}/track`)
      .query({ from, to })
      .set(strangerAuth)
      .expect(404);
    await request(server())
      .post(`/parent-location/my-devices/${dadDev.deviceId}/signal`)
      .set(momAuth)
      .expect(200);
    await request(server())
      .post(`/parent-location/my-devices/${dadDev.deviceId}/signal`)
      .set(strangerAuth)
      .expect(404);

    // Переименование: владелец — любой, участник — свой, чужой — 404
    const rename = (auth: Record<string, string>, id: string, name: unknown) =>
      request(server()).patch(`/parent-location/my-devices/${id}`).set(auth).send({ name });
    await rename(momAuth, dadDev.deviceId, '  Телефон папы ').expect(200, {
      id: dadDev.deviceId,
      customName: 'Телефон папы',
    });
    await rename(dadAuth, momDev.deviceId, 'Чужой').expect(404);
    await rename(strangerAuth, dadDev.deviceId, 'Чужой').expect(404);
    await rename(dadAuth, dadDev.deviceId, 'x'.repeat(41)).expect(400);
    await request(server())
      .patch(`/parent-location/my-devices/${dadDev.deviceId}`)
      .send({ name: 'x' })
      .expect(401);
    // Служба шлёт модель снова — заданное имя не перетирается
    await request(server())
      .post('/parent-location/points')
      .set('X-Parent-Location-Token', dadDev.token)
      .send({ points: [pt(500)], device: { name: 'Redmi Note', pushToken: 'fcm-dad' } })
      .expect(200);
    const renamed = await request(server()).get('/parent-location/my-devices').set(dadAuth);
    expect(renamed.body.items[0]).toMatchObject({
      customName: 'Телефон папы',
      deviceName: 'Redmi Note',
      isMine: true,
    });
    // Пустое имя — снова модель
    await rename(dadAuth, dadDev.deviceId, '   ').expect(200, {
      id: dadDev.deviceId,
      customName: null,
    });

    // Папа ушёл из семьи — владелец его телефон больше не видит
    await h.prisma.membership.deleteMany({ where: { userId: dad.userId, familyId: mom.familyId } });
    const after = await request(server()).get('/parent-location/my-devices').set(momAuth);
    expect(after.body.items.map((i: { id: string }) => i.id)).toEqual([momDev.deviceId]);
    await request(server())
      .post(`/parent-location/my-devices/${dadDev.deviceId}/signal`)
      .set(momAuth)
      .expect(404);
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
